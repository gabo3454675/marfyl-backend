import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { JSDOM } from 'jsdom';

const window = new JSDOM('').window;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const createDOMPurify = require('dompurify') as (w: typeof window) => {
  sanitize: (dirty: string, cfg?: Record<string, unknown>) => string;
};
const purify = createDOMPurify(window);

@ValidatorConstraint({ name: 'isSafeText', async: false })
export class IsSafeTextConstraint implements ValidatorConstraintInterface {
  validate(text: string) {
    if (typeof text !== 'string') return false;

    // Strip ALL HTML tags, keep only plain text
    const sanitized = purify.sanitize(text, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: [],
      KEEP_CONTENT: true,
    });

    // Allow only alphanumeric, spaces, common punctuation
    // Accents (á, é, í, ó, ú, ñ) are allowed via Unicode
    const safeTextRegex = /^[\p{L}\p{N}\s.,;:()\-'"]+$/u;
    return safeTextRegex.test(sanitized.trim());
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
