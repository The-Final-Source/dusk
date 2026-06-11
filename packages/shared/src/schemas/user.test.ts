// @intent-test-file shared/schemas/name-field/unit-tests
// @intent-test-file shared/schemas/email-field/unit-tests
// @intent-test-file shared/schemas/role-vocabulary/unit-tests
import { describe, it, expect } from "vitest";
import { CreateUserSchema, UserSchema, RoleSchema, UpdateUserRoleSchema } from "./user.js";

describe("CreateUserSchema", () => {
  it("accepts valid input", () => {
    const result = CreateUserSchema.safeParse({ name: "Alice", email: "alice@example.com" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = CreateUserSchema.safeParse({ name: "Alice", email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = CreateUserSchema.safeParse({ name: "", email: "alice@example.com" });
    expect(result.success).toBe(false);
  });

  it("rejects an email without a domain part", () => {
    const result = CreateUserSchema.safeParse({ name: "Alice", email: "alice@" });
    expect(result.success).toBe(false);
  });

  it("rejects an email without an @ separator", () => {
    const result = CreateUserSchema.safeParse({ name: "Alice", email: "alice.example.com" });
    expect(result.success).toBe(false);
  });
});

describe("RoleSchema", () => {
  it("accepts each closed-vocabulary role", () => {
    expect(RoleSchema.safeParse("user").success).toBe(true);
    expect(RoleSchema.safeParse("admin").success).toBe(true);
  });

  it("rejects a role outside the closed vocabulary", () => {
    expect(RoleSchema.safeParse("superadmin").success).toBe(false);
    expect(UpdateUserRoleSchema.safeParse({ email: "alice@example.com", role: "owner" }).success).toBe(false);
  });
});

describe("UserSchema", () => {
  it("accepts valid user", () => {
    const result = UserSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Alice",
      email: "alice@example.com",
      role: "user",
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid uuid", () => {
    const result = UserSchema.safeParse({
      id: "not-a-uuid",
      name: "Alice",
      email: "alice@example.com",
      role: "user",
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it("defaults role to user", () => {
    const result = UserSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Alice",
      email: "alice@example.com",
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("user");
    }
  });
});

describe("RoleSchema", () => {
  it("accepts valid roles", () => {
    expect(RoleSchema.safeParse("user").success).toBe(true);
    expect(RoleSchema.safeParse("admin").success).toBe(true);
  });

  it("rejects invalid role", () => {
    expect(RoleSchema.safeParse("superadmin").success).toBe(false);
  });
});

describe("UpdateUserRoleSchema", () => {
  it("accepts valid input", () => {
    const result = UpdateUserRoleSchema.safeParse({ email: "a@b.com", role: "admin" });
    expect(result.success).toBe(true);
  });
});
