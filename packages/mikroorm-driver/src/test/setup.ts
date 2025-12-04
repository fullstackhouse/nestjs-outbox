// Handle uncaught exceptions from pg client during test cleanup
// The pg library can throw "Cannot read properties of undefined (reading 'handleEmptyQuery')"
// when the client receives messages after end() has been called
process.on('uncaughtException', (err) => {
  if (
    err instanceof TypeError &&
    err.message.includes('handleEmptyQuery')
  ) {
    // Ignore this specific error from pg client cleanup
    return;
  }
  // Re-throw other errors
  throw err;
});
