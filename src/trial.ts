/**
 * Length of the signup trial. Source of truth: GET https://api.registrum.co.uk/v1/plans
 * -> signup_trial.days. Copied here only so error messages and the README guard
 * test share one constant; marketing-facts.test.ts fails if the README disagrees.
 */
export const TRIAL_DAYS = 60;
