require('tsx/cjs');           // register tsx for TS files in this worker
require('./workerEval.ts');   // now load the real TS worker
