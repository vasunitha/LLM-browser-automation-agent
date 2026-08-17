import { Router } from "express";
import type Database from "better-sqlite3";
import {
  findMemberById,
  listAccountsForMember,
  findAccountById,
  insertSubAccount,
} from "./db/repository";
import { validateSubAccountForm, LARGE_DEPOSIT_THRESHOLD_CENTS } from "./validation";
import { formatCentsAsDollars } from "./money";

/**
 * Routes for both capabilities:
 *  - get-savings-balance: GET / -> POST /members/search -> GET /members/:id
 *  - open-sub-account:    GET /members/:id/sub-account/new
 *                         -> POST /members/:id/sub-account
 *                         -> (validation errors | blocked | large-deposit confirm | success)
 *                         -> GET /accounts/:id/confirmation
 *
 * Every state has its own URL so it's bookmarkable/refreshable and gives
 * later phases a clean checkpoint (URL match) to assert against.
 */
export function createRouter(db: Database.Database): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const error = req.query.error === "missing-id" ? "Enter a member ID to search." : undefined;
    res.render("search", { error });
  });

  router.post("/members/search", (req, res) => {
    const memberId = String(req.body.memberId ?? "").trim();
    if (!memberId) {
      return res.redirect("/?error=missing-id");
    }

    const member = findMemberById(db, memberId);
    if (!member) {
      return res.redirect(`/members/not-found?memberId=${encodeURIComponent(memberId)}`);
    }

    return res.redirect(`/members/${encodeURIComponent(member.id)}`);
  });

  router.get("/members/not-found", (req, res) => {
    const memberId = String(req.query.memberId ?? "");
    res.render("member-not-found", { memberId });
  });

  router.get("/members/:id", (req, res) => {
    const member = findMemberById(db, req.params.id);
    if (!member) {
      return res.redirect(`/members/not-found?memberId=${encodeURIComponent(req.params.id)}`);
    }

    const accounts = listAccountsForMember(db, member.id);
    const savingsAccount = accounts.find((a) => a.accountType === "savings");
    const subAccounts = accounts
      .filter((a) => a.accountType === "sub_savings" || a.accountType === "sub_checking")
      .map((a) => ({ ...a, balanceDisplay: formatCentsAsDollars(a.balanceCents) }));

    return res.render("member-detail", {
      member,
      savingsAccount,
      savingsBalanceDisplay: savingsAccount ? formatCentsAsDollars(savingsAccount.balanceCents) : null,
      subAccounts,
    });
  });

  router.get("/members/:id/sub-account/new", (req, res) => {
    const member = findMemberById(db, req.params.id);
    if (!member) {
      return res.redirect(`/members/not-found?memberId=${encodeURIComponent(req.params.id)}`);
    }
    if (member.status === "restricted") {
      return res.redirect(`/members/${member.id}/sub-account/blocked`);
    }

    return res.render("sub-account-form", { member, errors: {}, values: {} });
  });

  router.get("/members/:id/sub-account/blocked", (req, res) => {
    const member = findMemberById(db, req.params.id);
    if (!member) {
      return res.redirect(`/members/not-found?memberId=${encodeURIComponent(req.params.id)}`);
    }
    return res.render("sub-account-blocked", { memberId: member.id });
  });

  router.post("/members/:id/sub-account", (req, res) => {
    const member = findMemberById(db, req.params.id);
    if (!member) {
      return res.redirect(`/members/not-found?memberId=${encodeURIComponent(req.params.id)}`);
    }
    if (member.status === "restricted") {
      return res.redirect(`/members/${member.id}/sub-account/blocked`);
    }

    const result = validateSubAccountForm(req.body);
    if (!result.valid) {
      return res.render("sub-account-form", { member, errors: result.errors, values: req.body });
    }

    if (result.data.initialDepositCents >= LARGE_DEPOSIT_THRESHOLD_CENTS) {
      return res.render("sub-account-large-deposit-confirm", {
        member,
        values: req.body,
        depositDisplay: formatCentsAsDollars(result.data.initialDepositCents),
        thresholdDisplay: formatCentsAsDollars(LARGE_DEPOSIT_THRESHOLD_CENTS),
      });
    }

    const account = insertSubAccount(db, {
      memberId: member.id,
      accountType: result.data.accountType,
      nickname: result.data.nickname,
      balanceCents: result.data.initialDepositCents,
    });

    return res.redirect(`/accounts/${encodeURIComponent(account.id)}/confirmation`);
  });

  router.post("/members/:id/sub-account/confirm-large-deposit", (req, res) => {
    const member = findMemberById(db, req.params.id);
    if (!member) {
      return res.redirect(`/members/not-found?memberId=${encodeURIComponent(req.params.id)}`);
    }
    if (member.status === "restricted") {
      return res.redirect(`/members/${member.id}/sub-account/blocked`);
    }

    // Re-validate the hidden fields rather than trusting them — never
    // trust a value just because it came back from an interstitial.
    const result = validateSubAccountForm(req.body);
    if (!result.valid) {
      return res.render("sub-account-form", { member, errors: result.errors, values: req.body });
    }

    const account = insertSubAccount(db, {
      memberId: member.id,
      accountType: result.data.accountType,
      nickname: result.data.nickname,
      balanceCents: result.data.initialDepositCents,
    });

    return res.redirect(`/accounts/${encodeURIComponent(account.id)}/confirmation`);
  });

  router.get("/accounts/:id/confirmation", (req, res) => {
    const account = findAccountById(db, req.params.id);
    if (!account) {
      return res.status(404).send("Account not found.");
    }
    const member = findMemberById(db, account.memberId);

    return res.render("sub-account-confirmation", {
      account,
      member,
      balanceDisplay: formatCentsAsDollars(account.balanceCents),
    });
  });

  return router;
}
