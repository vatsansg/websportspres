import { CanDeactivateFn } from '@angular/router';

// User-requested (2026-09-19, see workflow.md): covers every way of leaving the Asset
// Upload page - the "Back to Dashboard" button, a left-nav link click, Sign Out, browser
// back/forward - since Angular Router runs CanDeactivate for all of them, not just an
// explicit button click. Delegates entirely to the component: it alone knows whether
// "Force Email Send" is on and whether the currently selected event has unsent changes.
export interface CanDeactivateComponent {
  canDeactivateEmailPending(): boolean | Promise<boolean>;
}

export const unsentEmailGuard: CanDeactivateFn<CanDeactivateComponent> = (component) =>
  component.canDeactivateEmailPending();
