import { Sequelize } from 'sequelize-typescript';
import { ApplicationSetting, Document, DocumentEmbedding, DocumentFolder, DocumentStorageIssue, InboxItem, Issuer, MaintenanceRequest, MaintenanceRun, PipelineJob, PipelineJobEvent, User } from './models.js';
import { DocumentPage } from './document-page.model.js';
import { readPositiveInteger, readRequiredEnvironment } from './config.js';

export const sequelize = new Sequelize({
  dialect: 'postgres',
  host: readRequiredEnvironment('DATABASE_HOST'),
  port: readPositiveInteger('DATABASE_PORT', 5432),
  database: readRequiredEnvironment('DATABASE_NAME'),
  username: readRequiredEnvironment('DATABASE_USER'),
  password: readRequiredEnvironment('DATABASE_PASSWORD'),
  logging: false,
  pool: { max: 4, min: 0, idle: 10_000 }
});
sequelize.addModels([ApplicationSetting, User, Issuer, Document, DocumentFolder, DocumentStorageIssue, InboxItem, DocumentPage, DocumentEmbedding, PipelineJob, PipelineJobEvent, MaintenanceRun, MaintenanceRequest]);
