import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
import { User } from '../../authentication/models/user.entity';
import { SetupState } from '../models/setup-state.entity';
import { MaintenanceRun } from '../../maintenance/models/maintenance-run.entity';

export class SetupAlreadyCompletedError extends Error {
  constructor() {
    super('Initial administrator setup is already complete');
    this.name = SetupAlreadyCompletedError.name;
  }
}

export class SetupRecoveryInProgressError extends Error {
  constructor() {
    super('A first-run recovery restore is in progress');
    this.name = SetupRecoveryInProgressError.name;
  }
}

@Injectable()
export class SetupStateStore {
  private readonly singletonId = 1;

  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async isRequired(): Promise<boolean> {
    const state = await this.getState();
    const userCount = await User.count();
    return !state?.completedAt && userCount === 0;
  }

  async getState(): Promise<SetupState | null> {
    return SetupState.findByPk(this.singletonId);
  }

  async isOnboardingRequired(): Promise<boolean> {
    const [state, userCount] = await Promise.all([this.getState(), User.count()]);
    return userCount > 0 && !state?.onboardingCompletedAt;
  }

  async completeOnboarding(): Promise<Date> {
    return this.sequelize.transaction(async (transaction) => {
      const state = await SetupState.findByPk(this.singletonId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!state || !state.completedAt || (await User.count({ transaction })) === 0) {
        throw new SetupAlreadyCompletedError();
      }

      if (state.onboardingCompletedAt) {
        return state.onboardingCompletedAt;
      }

      const completedAt = new Date();
      await state.update({ onboardingCompletedAt: completedAt }, { transaction });
      return completedAt;
    });
  }

  async createInitialAdministrator(attributes: {
    username: string;
    passwordHash: string;
  }): Promise<User> {
    return this.sequelize.transaction(async (transaction) => {
      const state = await SetupState.findByPk(this.singletonId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!state || state.completedAt) {
        throw new SetupAlreadyCompletedError();
      }

      const existingUsers = await User.count({ transaction });
      if (existingUsers > 0) {
        await this.markCompleted(state, transaction);
        throw new SetupAlreadyCompletedError();
      }

      // The worker claims a first-run restore while holding this same setup-state row lock.
      // Prevent administrator creation from racing a restore after the worker has claimed it.
      const runningRestore = await MaintenanceRun.findOne({
        where: { jobKey: 'restore', status: 'running' },
        transaction,
      });
      if (runningRestore) throw new SetupRecoveryInProgressError();

      const user = await User.create(
        {
          username: attributes.username,
          passwordHash: attributes.passwordHash,
          isAdmin: true,
          isActive: true,
          mustChangePassword: false,
        },
        { transaction },
      );

      await this.markCompleted(state, transaction);
      return user;
    });
  }

  private async markCompleted(state: SetupState, transaction: Transaction): Promise<void> {
    await state.update({ completedAt: new Date() }, { transaction });
  }
}
