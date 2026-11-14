'use strict';
const { createDeferredResponse } = require('./deferred-response');
const { withLockedRowState } = require('./row-state-writer');

class RejectedResponse extends Error {}

async function runBufferedRowMutation(pool, response, handler, shouldApply = () => true, options = {}) {
  const deferred = createDeferredResponse(response);
  try {
    const transact = options.transact || withLockedRowState;
    await transact(pool, async (state, connection) => {
      await handler(state, deferred.response, connection);
      if (!deferred.ended) throw new Error('Handler did not finish its response');
      if (deferred.statusCode >= 400 && !(options.commitOnError && options.commitOnError(deferred.statusCode))) throw new RejectedResponse();
    }, shouldApply, options);
    if (options.afterCommit) options.afterCommit();
  } catch (error) {
    if (!(error instanceof RejectedResponse)) throw error;
  }
  if (!options.deferSuccess || deferred.statusCode >= 400) deferred.flush();
}

module.exports = { runBufferedRowMutation };
