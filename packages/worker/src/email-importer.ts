import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config, decryptSettingSecret } from './config.js';
import { EmailImportConfig } from './models.js';
import { importEmailPdf } from './inbox-importer.js';
import { logger } from './logger.js';

const MAX_MESSAGE_BYTES = 50 * 1024 * 1024;
let lastRunAt = 0;

export async function importEmailMessages(force = false): Promise<void> {
  if (!force && Date.now() - lastRunAt < Math.min(config.pollIntervalMs, 60_000)) return;
  lastRunAt = Date.now();

  const mailboxes = await EmailImportConfig.findAll({ where: { enabled: true } });
  for (const mailbox of mailboxes) {
    if (!force && mailbox.lastPolledAt && Date.now() - mailbox.lastPolledAt.getTime() < mailbox.pollIntervalMs)
      continue;
    await pollMailbox(mailbox);
  }
}

async function pollMailbox(mailbox: EmailImportConfig): Promise<void> {
  let client: ImapFlow | undefined;

  try {
    client = new ImapFlow({
      host: mailbox.host,
      port: mailbox.port,
      secure: mailbox.secure,
      auth: {
        user: mailbox.username,
        pass: decryptSettingSecret(mailbox.password ?? '', mailbox.passwordIv ?? ''),
      },
      logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock(mailbox.mailbox);
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (!Array.isArray(uids)) return;
      let handled = 0;
      for (const uid of uids.slice(0, 50)) {
        const message = await client.fetchOne(uid, { uid: true, envelope: true, source: true }, { uid: true });
        if (!message) continue;
        const sender = message.envelope?.from?.find((entry) => entry.address)?.address?.toLowerCase();
        if (!sender || (mailbox.trustedSenders.length > 0 && !mailbox.trustedSenders.includes(sender))) {
          logger.info('Skipped email from untrusted sender', { mailboxUuid: mailbox.uuid, sender });
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          continue;
        }

        const source = Buffer.isBuffer(message.source) ? message.source : Buffer.from(message.source ?? '');
        if (source.length > MAX_MESSAGE_BYTES) {
          logger.warn('Skipped oversized email message', { mailboxUuid: mailbox.uuid, uid, sizeBytes: source.length });
          continue;
        }

        const parsed = await simpleParser(source, { skipHtmlToText: true, skipTextToHtml: true });
        const pdfs = parsed.attachments.filter(
          (attachment) =>
            attachment.contentType.toLowerCase() === 'application/pdf' &&
            attachment.filename?.toLowerCase().endsWith('.pdf') &&
            attachment.size <= config.maxUploadBytes,
        );
        if (pdfs.length === 0) continue;

        let allImported = true;
        for (const attachment of pdfs) {
          const result = await importEmailPdf(
            attachment.content,
            attachment.filename ?? `email-${uid}.pdf`,
            mailbox.ownerUuid,
          );
          if (result === 'rejected') allImported = false;
          handled += 1;
        }
        if (allImported) {
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          if (mailbox.deleteAfterImport) await client.messageDelete(uid, { uid: true });
        }
      }
      await mailbox.update({ lastPolledAt: new Date(), lastError: null });
      if (handled > 0) logger.info('Email import completed', { mailboxUuid: mailbox.uuid, handled });
    } finally {
      lock.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mailbox.update({ lastPolledAt: new Date(), lastError: message.slice(0, 2000) }).catch(() => undefined);
    logger.warn('Email mailbox polling failed', { mailboxUuid: mailbox.uuid, error: message });
  } finally {
    await client?.logout().catch(() => undefined);
  }
}
