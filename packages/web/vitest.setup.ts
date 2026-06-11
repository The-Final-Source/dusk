// React 19 act() environment for @testing-library/react under vitest/jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
