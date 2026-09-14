import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      // factory ולא `providers: [PrismaService]`: הבנייה חייבת לעבור
      // דרך `create()`, שתופס את ה-Proxy של PrismaClient. ראו ההסבר
      // על `untenanted` ב-prisma.service.ts.
      useFactory: (): PrismaService => PrismaService.create(),
    },
  ],
  exports: [PrismaService],
})
export class DatabaseModule {}
