import { randomUUID } from 'node:crypto';
import { Op, Transaction } from 'sequelize';
import { config } from './config.js';
import { sequelize } from './database.js';
import { Document, PipelineJob, PipelineJobEvent, JobKind } from './models.js';
import { logger } from './logger.js';
import { createThumbnail, writeDerivedText } from './storage.js';
import { extractPdfPages } from './extraction.js';
import { runOcr } from './ocr.js';
import { embedDocument } from './embeddings.js';
import { importInboxDocuments } from './inbox-importer.js';
import { matchDocumentIssuer } from './issuer-matcher.js';
interface ClaimedJob { jobUuid:string; documentUuid:string; ownerUuid:string; kind:JobKind; attempts:number; maxAttempts:number; storageKey:string; }
let stopping = false;
export async function startPipelineWorker():Promise<void>{ logger.info('Pipeline worker starting',{workerId:config.workerId,storageRoot:config.storageRoot,inboxEnabled:config.inbox.enabled}); await recoverStaleJobs(); await importInboxDocuments(true); await reconcileUploadedDocuments(); await logQueueStatus(); let last=Date.now(); while(!stopping){ try{await importInboxDocuments();if(Date.now()-last>=config.reconcileIntervalMs){await reconcileUploadedDocuments();last=Date.now();} const job=await claimNextJob(); if(job){await processJob(job);continue;} logger.debug('Pipeline queue is empty; waiting for jobs',{pollIntervalMs:config.pollIntervalMs});}catch(error){logger.error('Pipeline polling cycle failed; will retry',{error:error instanceof Error?error.message:String(error)});} await delay(config.pollIntervalMs); } }
export function requestShutdown():void{stopping=true;}
async function reconcileUploadedDocuments():Promise<void>{const documents=await Document.findAll({where:{status:'uploaded'}});let created=0;for(const candidate of documents)await sequelize.transaction(async transaction=>{const document=await Document.findByPk(candidate.uuid,{transaction,lock:transaction.LOCK.UPDATE});if(!document||document.status!=='uploaded')return;const existing=await PipelineJob.findOne({where:{documentUuid:document.uuid,kind:'text-extraction',status:{[Op.in]:['queued','running','succeeded']}},transaction});if(existing)return;const job=await PipelineJob.create({uuid:randomUUID(),documentUuid:document.uuid,ownerUuid:document.ownerUuid,kind:'text-extraction',status:'queued',attempts:0,maxAttempts:3,availableAt:new Date(),lockedAt:null,lockedBy:null,startedAt:null,completedAt:null,lastError:null},{transaction});await PipelineJobEvent.create({uuid:randomUUID(),jobUuid:job.uuid,type:'queued',message:'Queued by worker reconciliation'},{transaction});created+=1;});logger.info('Reconciled uploaded documents',{uploaded:documents.length,jobsCreated:created});}
async function claimNextJob():Promise<ClaimedJob|null>{return sequelize.transaction(async transaction=>{const job=await PipelineJob.findOne({where:{status:'queued',availableAt:{[Op.lte]:new Date()}},include:[{model:Document,required:true}],order:[['createdAt','ASC']],transaction,lock:transaction.LOCK.UPDATE,skipLocked:true});if(!job)return null;const attempts=job.attempts+1;await job.update({status:'running',attempts,lockedAt:new Date(),lockedBy:config.workerId,startedAt:job.startedAt??new Date()},{transaction});await Document.update({status:'processing'},{where:{uuid:job.documentUuid,status:{[Op.in]:['uploaded','failed']}},transaction});await addEvent(transaction,job.uuid,'claimed',`Claimed by ${config.workerId}`);logger.info('Claimed pipeline job',{jobUuid:job.uuid,kind:job.kind});return{jobUuid:job.uuid,documentUuid:job.documentUuid,ownerUuid:job.ownerUuid,kind:job.kind,attempts,maxAttempts:job.maxAttempts,storageKey:job.document?.storageKey??''};});}
async function processJob(job: ClaimedJob): Promise<void> {
  logger.info('Processing pipeline job', {
    jobUuid: job.jobUuid,
    documentUuid: job.documentUuid,
    kind: job.kind
  });

  try {
    switch (job.kind) {
      case 'text-extraction': {
        const extracted = await extractPdfPages(job.storageKey);

        if (extracted.requiresOcr) {
          logger.warn('Unusable PDF text layer detected; queueing OCR', {
            documentUuid: job.documentUuid,
            jobUuid: job.jobUuid
          });
          await writeDerivedText(job.documentUuid, '');
          await persistPages(job.documentUuid, []);
          await completeJob(job, true);
          break;
        }

        await writeDerivedText(job.documentUuid, extracted.text);
        await persistPages(job.documentUuid, extracted.pages);
        await matchDocumentIssuer(job.documentUuid, job.ownerUuid, extracted.text);
        await completeJob(job, false);
        break;
      }

      case 'thumbnail':
        await createThumbnail(job.storageKey, job.documentUuid);
        await completeJob(job, false);
        break;

      case 'ocr': {
        const key = await runOcr(job.storageKey, job.documentUuid);
        const extracted = await extractPdfPages(key);

        if (extracted.requiresOcr) {
          throw new Error('OCR completed but produced no usable searchable text');
        }

        await writeDerivedText(job.documentUuid, extracted.text);
        await persistPages(job.documentUuid, extracted.pages);
        await matchDocumentIssuer(job.documentUuid, job.ownerUuid, extracted.text);
        await completeJob(job, false);
        break;
      }

      case 'embedding':
        await embedDocument(job.documentUuid);
        await completeJob(job, false);
        break;
    }
  } catch (error) {
    await failJob(job, error instanceof Error ? error.message : String(error));
  }
}
async function persistPages(documentUuid:string,pages:string[]):Promise<void>{const{DocumentPage}=await import('./document-page.model.js');const pageCount=Math.max(1,pages.length);await sequelize.transaction(async transaction=>{await DocumentPage.destroy({where:{documentUuid},transaction});if(pages.length)await DocumentPage.bulkCreate(pages.map((text,i)=>({uuid:randomUUID(),documentUuid,pageNumber:i+1,text})),{transaction});await Document.update({pageCount},{where:{uuid:documentUuid},transaction});});logger.info('Persisted extracted document pages',{documentUuid,pageCount,textLength:pages.join('').length});}
async function completeJob(job: ClaimedJob, needsOcr: boolean): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    await PipelineJob.update(
      {
        status: 'succeeded',
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null
      },
      { where: { uuid: job.jobUuid }, transaction }
    );

    if (needsOcr) {
      await Document.update(
        { status: 'processing' },
        { where: { uuid: job.documentUuid }, transaction }
      );
      await queueFollowup(
        transaction,
        job,
        'ocr',
        'No usable text layer found; queued OCR'
      );
    } else if (
      (job.kind === 'text-extraction' || job.kind === 'ocr') &&
      config.embeddings.enabled
    ) {
      await Document.update(
        { status: 'processing' },
        { where: { uuid: job.documentUuid }, transaction }
      );
      await queueFollowup(transaction, job, 'embedding', 'Queued hosted embeddings');
    } else {
      await Document.update(
        { status: 'ready' },
        { where: { uuid: job.documentUuid }, transaction }
      );
      await addEvent(transaction, job.jobUuid, 'completed', 'Job completed');
    }
  });

  logger.info('Pipeline job completed', {
    jobUuid: job.jobUuid,
    kind: job.kind,
    needsOcr
  });
}
async function queueFollowup(transaction:Transaction,job:ClaimedJob,kind:JobKind,message:string):Promise<void>{const existing=await PipelineJob.findOne({where:{documentUuid:job.documentUuid,kind,status:{[Op.in]:['queued','running']}},transaction});await addEvent(transaction,job.jobUuid,kind==='ocr'?'ocr-required':'embedding-queued',message);if(!existing){const next=await PipelineJob.create({uuid:randomUUID(),documentUuid:job.documentUuid,ownerUuid:job.ownerUuid,kind,status:'queued',attempts:0,maxAttempts:3,availableAt:new Date(),lockedAt:null,lockedBy:null,startedAt:null,completedAt:null,lastError:null},{transaction});await addEvent(transaction,next.uuid,'queued',`Queued ${kind}`);}}
async function failJob(job:ClaimedJob,message:string):Promise<void>{const safe=message.slice(0,2000);try{const retry=job.attempts<job.maxAttempts;await sequelize.transaction(async transaction=>{if(retry){const delayMs=Math.min(300000,1000*2**Math.max(0,job.attempts-1));await PipelineJob.update({status:'queued',availableAt:new Date(Date.now()+delayMs),lockedAt:null,lockedBy:null,lastError:safe},{where:{uuid:job.jobUuid},transaction});await addEvent(transaction,job.jobUuid,'retry-scheduled',`Retry scheduled: ${safe}`);}else{await PipelineJob.update({status:'failed',completedAt:new Date(),lockedAt:null,lockedBy:null,lastError:safe},{where:{uuid:job.jobUuid},transaction});await Document.update({status:'failed'},{where:{uuid:job.documentUuid},transaction});await addEvent(transaction,job.jobUuid,'failed',safe);}});logger.error('Pipeline job failed',{jobUuid:job.jobUuid,retry,error:safe});}catch(error){logger.error('Unable to record pipeline failure',{jobUuid:job.jobUuid,error});}}
async function recoverStaleJobs():Promise<void>{const stale=await PipelineJob.findAll({where:{status:'running',lockedAt:{[Op.lt]:new Date(Date.now()-config.lockTimeoutMs)}}});for(const job of stale){const message=`${job.lastError?`${job.lastError}; `:''}Recovered after worker lock timeout`.slice(0,2000);await job.update({status:'queued',lockedAt:null,lockedBy:null,lastError:message,availableAt:new Date()});await PipelineJobEvent.create({uuid:randomUUID(),jobUuid:job.uuid,type:'recovered',message});}logger.info('Checked for stale pipeline jobs',{recovered:stale.length});}
async function logQueueStatus():Promise<void>{const statuses=['queued','running','succeeded','failed','cancelled'] as const;const counts=await Promise.all(statuses.map(async status=>[status,await PipelineJob.count({where:{status}})] as const));logger.info('Pipeline queue status',{jobs:Object.fromEntries(counts),embeddingsEnabled:config.embeddings.enabled});}
async function addEvent(transaction:Transaction,jobUuid:string,type:string,message:string):Promise<void>{await PipelineJobEvent.create({uuid:randomUUID(),jobUuid,type,message:message.slice(0,2000)},{transaction});}
function delay(milliseconds:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,milliseconds));}
