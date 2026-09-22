/**
 * Field limits, GENERATED from core's OpenAPI contract. Do not edit by hand:
 * run `npm run limits:refresh`, and `npm run limits:check` proves this file
 * still matches the contract.
 *
 * Source: https://core.mnemoverse.com/openapi.json
 * Core API version: 1.0.0
 *
 * ADR-025 (mnemoverse-core): the engine sets a field's limits; this package
 * reads them. A limit the package invents drifts the moment the engine moves,
 * which is what happened to `top_k` (50 here against 500 there) and to
 * `domain` (unbounded here against 100 there).
 */

export const CORE_LIMITS = {
  writeContent: {
    minLength: 1,
    maxLength: 10000,
  },
  writeConcepts: {
    maxItems: 256,
  },
  domain: {
    maxLength: 100,
  },
  readQuery: {
    minLength: 1,
    maxLength: 5000,
  },
  readTopK: {
    minimum: 1,
    maximum: 500,
    default: 10,
  },
  recentLimit: {
    minimum: 1,
    maximum: 100,
    default: 20,
  },
  recentCursor: {
    maxLength: 512,
  },
  feedbackOutcome: {
    minimum: -1,
    maximum: 1,
  },
  roomName: {
    minLength: 1,
    maxLength: 200,
  },
  roomDescription: {
    maxLength: 2000,
  },
  inviteExpiresInDays: {
    minimum: 1,
    maximum: 90,
    default: 7,
  },
  inviteMaxUses: {
    minimum: 1,
    maximum: 1000,
    default: 1,
  },
} as const;

/** The contract this file was generated from, for the freshness check. */
export const CORE_CONTRACT = {
  url: "https://core.mnemoverse.com/openapi.json",
  apiVersion: "1.0.0",
} as const;
