import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingFinalizeService } from './onboarding-finalize.service';
import { DocumentLearningService } from './document-learning.service';
import { OnboardingController } from './onboarding.controller';

@Module({
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingFinalizeService, DocumentLearningService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
