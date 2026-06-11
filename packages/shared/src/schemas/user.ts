import { z } from "zod";

// @intent shared/schemas/role-vocabulary [closed-enum]
export const RoleSchema = z.enum(["user", "admin"]);
export type Role = z.infer<typeof RoleSchema>;

// @intent shared/schemas/name-field [reject-empty-or-whitespace-name]
// @intent shared/schemas/email-field [reject-invalid-email-format]
export const CreateUserSchema = z.object({
  // @intent shared/schemas/name-field [reject-empty-or-whitespace-name]
  name: z.string().trim().min(1, "Name is required"),
  // @intent shared/schemas/email-field [reject-invalid-email-format]
  email: z.string().email("Invalid email address"),
});

// @intent shared/schemas/email-field [reject-invalid-email-format]
// @intent shared/schemas/name-field [reject-empty-or-whitespace-name]
// @intent shared/schemas/role-vocabulary [closed-enum]
export const UserSchema = CreateUserSchema.extend({
  id: z.string().uuid(),
  // @intent shared/schemas/role-vocabulary [closed-enum]
  role: RoleSchema.default("user"),
  avatarUrl: z.string().url().nullable().default(null),
  lastLoginAt: z.date().nullable().default(null),
  createdAt: z.date(),
});

// @intent shared/schemas/email-field [reject-invalid-email-format]
// @intent shared/schemas/role-vocabulary [closed-enum]
export const UpdateUserRoleSchema = z.object({
  // @intent shared/schemas/email-field [reject-invalid-email-format]
  email: z.string().email(),
  // @intent shared/schemas/role-vocabulary [closed-enum]
  role: RoleSchema,
});

export type User = z.infer<typeof UserSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUserRole = z.infer<typeof UpdateUserRoleSchema>;
