import { UserRoles } from "@src/enums/user-roles";
import { UserAccount } from "@src/types/user-account";
import { readFileSync } from "node:fs";
import process from "process";

export function getAccounts(): UserAccount[] {
  return JSON.parse(readFileSync(process.env.ACCOUNTS_JSON as string, "utf-8"));
}

export function getAccountForRole(userRole: UserRoles): UserAccount {
  const user = getAccounts().find((account) => account.role === userRole);
  if (!user) {
    throw Error(`User not found for ${userRole}`);
  }
  return user;
}
