import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { isFlexibleDateString } from "@/common/helpers/parse-query-date";

@ValidatorConstraint({ name: "isFlexibleDate", async: false })
export class IsFlexibleDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isFlexibleDateString(value);
  }

  defaultMessage(): string {
    return "debe ser una fecha válida (DD/MM/YYYY, YYYY-MM-DD o ISO 8601)";
  }
}

/** Acepta DD/MM/YYYY, YYYY-MM-DD o ISO 8601 datetime. */
export function IsFlexibleDate(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsFlexibleDateConstraint,
    });
  };
}
