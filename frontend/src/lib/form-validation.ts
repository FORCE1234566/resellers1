import { validateNetworkPhone } from './network-phone';

type Validator = (value: string) => string | null;

export const v = {
  required:
    (label: string): Validator =>
    (value) =>
      value.trim() ? null : `${label} is required`,

  email: (value: string) => {
    if (!value.trim()) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Enter a valid email address';
  },

  phone: (value: string) => {
    if (!value.trim()) return null;
    return /^0\d{9}$/.test(value) ? null : 'Phone must be 10 digits starting with 0';
  },

  networkPhone:
    (network: string): Validator =>
    (value) => {
      if (!value.trim()) return null;
      return validateNetworkPhone(value, network);
    },

  match:
    (other: string, label: string): Validator =>
    (value) =>
      value === other ? null : `${label} do not match`,

  minAmount:
    (min: number, label: string): Validator =>
    (value) => {
      const num = Number(value);
      if (!value.trim()) return null;
      return num >= min ? null : `${label} must be at least GHS ${min}`;
    },

  maxAmount:
    (max: number, label: string): Validator =>
    (value) => {
      const num = Number(value);
      if (!value.trim()) return null;
      return num <= max ? null : `${label} cannot exceed GHS ${max.toLocaleString()}`;
    },

  /** Reject values that look like Ghana phone numbers entered by mistake */
  notPhoneNumber: (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^0\d{9}$/.test(trimmed)) {
      return 'Enter an amount in GHS, not a phone number';
    }
    return null;
  },
};

export function runValidators(
  fields: Record<string, string>,
  schema: Record<string, Validator[]>
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const [key, validators] of Object.entries(schema)) {
    for (const check of validators) {
      const message = check(fields[key] ?? '');
      if (message) {
        errors[key] = message;
        break;
      }
    }
  }

  return errors;
}

export function validateLoginFields(email: string, password: string) {
  return runValidators(
    { email, password },
    {
      email: [v.required('Email'), v.email],
      password: [v.required('Password')],
    }
  );
}

export function validateRegisterFields(form: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}) {
  return runValidators(form, {
    fullName: [v.required('Full name')],
    email: [v.required('Email'), v.email],
    phone: [v.required('Phone'), v.phone],
    password: [v.required('Password')],
    confirmPassword: [v.required('Confirm password'), v.match(form.password, 'Passwords')],
  });
}
