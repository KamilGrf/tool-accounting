import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setLogLevel } from '../logger.js';

// The app journals to the console; keep test output clean (logger tests switch it on explicitly).
setLogLevel('silent');

afterEach(() => cleanup());
