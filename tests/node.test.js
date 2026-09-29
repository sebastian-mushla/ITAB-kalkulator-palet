// Same cases for Node (>= 18): `node --test tests/`
import test from 'node:test';
import { cases } from './cases.js';

cases.forEach(([name, fn]) => test(name, fn));
