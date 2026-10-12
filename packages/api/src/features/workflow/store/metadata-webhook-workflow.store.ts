import { Injectable } from '@nestjs/common';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import {
  MetadataWebhookWorkflow,
  MetadataWebhookApprovalStatus,
} from '../models/metadata-webhook-workflow.entity';
import { User } from '../../authentication/models/user.entity';

/** Datastore access for user-owned workflow definitions and admin review. */
@Injectable()
export class MetadataWebhookWorkflowStore extends BaseCrudStore<MetadataWebhookWorkflow> {
  constructor() {
    super(MetadataWebhookWorkflow);
    this.registerIdField('uuid');
  }

  /** Lists a user's workflows or every workflow when called by an administrator. */
  list(ownerUuid?: string): Promise<MetadataWebhookWorkflow[]> {
    return this.model.findAll({
      where: ownerUuid ? { ownerUuid } : undefined,
      order: [
        ['createdAt', 'DESC'],
        ['uuid', 'ASC'],
      ],
      include: [{ model: User, as: 'owner', attributes: ['uuid', 'username', 'email'] }],
    });
  }

  /** Returns a specific workflow only when it belongs to the supplied user. */
  findOwned(uuid: string, ownerUuid: string): Promise<MetadataWebhookWorkflow | null> {
    return this.model.findOne({ where: { uuid, ownerUuid } });
  }

  /** Finds a workflow by identifier for dispatch and administrator actions. */
  findByUuid(uuid: string): Promise<MetadataWebhookWorkflow | null> {
    return this.model.findByPk(uuid);
  }

  /** Adds one workflow and leaves it pending until an administrator approves it. */
  createWorkflow(input: {
    ownerUuid: string;
    name: string;
    enabled: boolean;
    field: string;
    operator: string;
    value: string;
    url: string;
    bearerToken: string | null;
    bearerTokenIv: string | null;
    payloadTemplate: string;
    approvalStatus: MetadataWebhookApprovalStatus;
    reviewedBy?: string | null;
    reviewedAt?: Date | null;
    reviewNote?: string | null;
  }): Promise<MetadataWebhookWorkflow> {
    return this.model.create(input);
  }

  /** Updates a user's workflow and resets review metadata when its configuration changes. */
  async updateOwned(
    uuid: string,
    ownerUuid: string,
    changes: Partial<
      Pick<
        MetadataWebhookWorkflow,
        | 'name'
        | 'enabled'
        | 'field'
        | 'operator'
        | 'value'
        | 'url'
        | 'bearerToken'
        | 'bearerTokenIv'
        | 'payloadTemplate'
        | 'approvalStatus'
        | 'reviewedBy'
        | 'reviewedAt'
        | 'reviewNote'
      >
    >,
  ): Promise<MetadataWebhookWorkflow | null> {
    const workflow = await this.findOwned(uuid, ownerUuid);
    if (!workflow) return null;
    await workflow.update(changes);
    return workflow;
  }

  /** Removes a workflow and its queued delivery history. */
  async deleteOwned(uuid: string, ownerUuid: string): Promise<boolean> {
    return (await this.model.destroy({ where: { uuid, ownerUuid } })) > 0;
  }

  /** Stores an administrator's approval or rejection decision. */
  async review(
    uuid: string,
    status: Extract<MetadataWebhookApprovalStatus, 'approved' | 'rejected'>,
    reviewerUuid: string,
    note: string | null,
  ): Promise<MetadataWebhookWorkflow | null> {
    const workflow = await this.model.findByPk(uuid);
    if (!workflow) return null;
    await workflow.update({
      approvalStatus: status,
      reviewedBy: reviewerUuid,
      reviewedAt: new Date(),
      reviewNote: note,
    });
    return workflow;
  }

  /** Finds approved enabled rules for a particular document owner. */
  findRunnable(ownerUuid: string): Promise<MetadataWebhookWorkflow[]> {
    return this.model.findAll({
      where: { ownerUuid, enabled: true, approvalStatus: 'approved' },
      order: [
        ['createdAt', 'ASC'],
        ['uuid', 'ASC'],
      ],
    });
  }

  /** Finds all workflows waiting for an administrator's decision. */
  findPendingReview(): Promise<MetadataWebhookWorkflow[]> {
    return this.model.findAll({
      where: { approvalStatus: 'pending' },
      order: [
        ['createdAt', 'ASC'],
        ['uuid', 'ASC'],
      ],
      include: [{ model: User, as: 'owner', attributes: ['uuid', 'username', 'email'] }],
    });
  }
}
