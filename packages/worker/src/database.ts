import { Sequelize } from 'sequelize-typescript';
import { ApplicationSetting, Document, DocumentEmbedding, InboxItem, PipelineJob, PipelineJobEvent, User } from './models.js';
import { DocumentPage } from './document-page.model.js';
import { readPositiveInteger } from './config.js';

export const sequelize = new Sequelize({ dialect: 'postgres', host: process.env.DATABASE_HOST ?? 'localhost', port: readPositiveInteger('DATABASE_PORT', 5432), database: process.env.DATABASE_NAME ?? 'binder', username: process.env.DATABASE_USER ?? 'binder', password: process.env.DATABASE_PASSWORD ?? 'binder', logging: false, pool: { max: 4, min: 0, idle: 10_000 } });
sequelize.addModels([ApplicationSetting, User, Document, InboxItem, DocumentPage, DocumentEmbedding, PipelineJob, PipelineJobEvent]);
