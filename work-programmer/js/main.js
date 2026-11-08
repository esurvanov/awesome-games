'use strict';
// Сборка «Аптайма»: подтягивает части через реестр и открывает главный экран.
L.def('main', () => {
  const { start } = L.use('ui/app');
  start();
  return {};
});
