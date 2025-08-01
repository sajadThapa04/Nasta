import validator from "validator";

// Function to validate password strength
export const isPasswordStrong = password => {
  return (/[A-Z]/.test(password) && // At least one uppercase letter
      /[a-z]/.test(password) && // At least one lowercase letter
      /\d/.test(password) && // At least one digit
      /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) && // At least one special character
      password.length >= 6); // Minimum length requirement);
};

// Function to validate email format
export const isEmailValid = email => {
  return validator.isEmail(email);
};

// Function to validate phone number (basic check)
export const isPhoneValid = phone => {
  return validator.isMobilePhone(phone, "any", {strictMode: false});
};

// Function to validate role (traveler or host)
export const isRoleValid = role => {
  const allowedRoles = ["traveler", "host"];
  return allowedRoles.includes(role);
};

// Function to validate if a string is empty
export const isStringEmpty = str => {
  return !str || str.trim() === "";
};

// Function to validate if all required fields are provided
export const areRequiredFieldsProvided = fields => {
  return fields.every(field => !isStringEmpty(field));
};