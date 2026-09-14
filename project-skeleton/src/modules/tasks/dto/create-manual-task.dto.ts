import { IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateManualTaskDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  jobTypeTemplateId!: string;

  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;

  // שדות התבנית הם דינמיים לפי JobTypeTemplate.fields, ולכן נבדקים
  // כאן רק כאובייקט. תוכנם מאומת מול התבנית בשכבת השירות.
  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}
