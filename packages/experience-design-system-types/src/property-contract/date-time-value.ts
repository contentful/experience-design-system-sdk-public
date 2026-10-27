import * as z from 'zod/mini';

const dateTimeValueSchema = z.iso.datetime({ offset: true });

/** Preserve timezone-qualified ISO datetime strings without coercion or normalization. */
export function isDateTimeValue(value: unknown): value is string {
  return dateTimeValueSchema.safeParse(value).success;
}
