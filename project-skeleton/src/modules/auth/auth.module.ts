import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { RolesGuard } from '../../common/guards/roles.guard';
import type { AppEnv } from '../../config/env.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // אין fallback לסוד. `config.get('JWT_SECRET', 'dev-only-...')`
      // החזיר את ברירת המחדל גם כשהמשתנה ריק, כך שקונטיינר פרודקשן
      // חתם טוקנים בסוד שנמצא בעץ המקור. הערך מאומת עכשיו ב-env.schema
      // בזמן עלייה, וקריאה בלי ברירת מחדל היא מה שמבטיח שנצרוך אותו.
      // ראו docs/10-audit-findings.md#I1.
      useFactory: (config: ConfigService<AppEnv, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController],
  // JwtAuthGuard ו-RolesGuard מיוצאים כדי ש-AppModule יוכל לרשום אותם
  // כ-APP_GUARD גלובליים. ראו src/app.module.ts.
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
