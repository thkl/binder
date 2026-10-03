import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { ClassificationFeedbackService } from '../service/classification-feedback.service';

@Controller('classification-feedback')
@UseGuards(AuthenticationGuard)
export class ClassificationFeedbackController {
  constructor(private readonly feedback: ClassificationFeedbackService) {}

  @Get()
  async list(@CurrentUser() user: ScopedUser) {
    return { data: await this.feedback.list(user.userId) };
  }

  @Delete(':uuid')
  async remove(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.feedback.remove(user.userId, uuid) };
  }
}
