import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { GoogleOAuthService } from './google-oauth.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { OAuthStateService } from './oauth-state.service';

@Module({
  imports: [
    // JwtModule נפרד לחלוטין מזה שב-AuthModule, ועם **סוד אחר**:
    // OAUTH_STATE_SECRET. קודם שניהם חתמו ב-JWT_SECRET, כך שטוקן
    // ה-state — שנוסע ב-query string דרך השרתים של Google ונוחת
    // בהיסטוריית הדפדפן, ב-Referer ובלוגים — היה טוקן גישה תקף לגמרי.
    // ה-env schema אוכף שהסודות שונים זה מזה.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // בלי ברירת מחדל: משתנה חסר נתפס ב-validateEnv בזמן עלייה,
        // ולא הופך בשקט לסוד שנמצא בעץ המקור.
        secret: config.getOrThrow<string>('OAUTH_STATE_SECRET'),
      }),
    }),
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, GoogleOAuthService, OAuthStateService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
