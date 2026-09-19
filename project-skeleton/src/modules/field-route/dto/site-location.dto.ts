import { IsLatitude, IsLongitude, IsNumber, Max, Min } from 'class-validator';

/** מיקום הטלפון של הטכנאי כשסגר עבודה — כך המערכת לומדת איפה הלקוח. */
export class SiteLocationDto {
  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  /** רדיוס הדיוק במטרים, כפי שהדפדפן מדווח. */
  @IsNumber()
  @Min(0)
  @Max(100_000)
  accuracyM!: number;
}
