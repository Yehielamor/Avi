import { Global, Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';

/**
 * Global: יצירת טננט וקריאת הקונפיג שלו נדרשות גם ב-onboarding וגם
 * במודולים שלא מייבאים את TenantsModule במפורש. זו עדיין ספק יחיד —
 * הכוונה היא למנוע שכפול של createTenant() כמו שקרה ב-onboarding.
 */
@Global()
@Module({
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
