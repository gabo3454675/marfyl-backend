import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

/** Elimina etiquetas HTML sin depender de DOMPurify/jsdom en runtime Node. */
function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

@ValidatorConstraint({ name: 'isSafeText', async: false })
export class IsSafeTextConstraint implements ValidatorConstraintInterface {
  validate(text: string) {
    if (typeof text !== 'string') return false;

    const sanitized = stripHtml(text).trim();
    const safeTextRegex = /^[\p{L}\p{N}\s.,;:()\-'"]+$/u;
    return safeTextRegex.test(sanitized);
  }

  defaultMessage() {
    return 'Text contains invalid characters. Only letters, numbers, spaces, and basic punctuation are allowed.';
  }
}

export function IsSafeText(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsSafeTextConstraint,
    });
  };
}
