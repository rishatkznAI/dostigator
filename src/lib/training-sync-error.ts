type ApiError = { code?: string; message?: string }

/** Keep backend incompatibility distinct from connectivity and version conflicts. */
export function trainingSyncError(error: ApiError): Error {
  if(error.code==='PT426') return new Error('Обновите приложение. Локальные данные сохранены; сервер требует защищённую версию синхронизации.')
  if (['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01'].includes(error.code ?? '')) {
    return new Error('Сервер ещё не обновлён для V2.1. Данные сохранены на устройстве. Для облачной синхронизации требуется обновление сервера.')
  }
  if (['40001','PT409'].includes(error.code ?? '')) return new Error('Тренировка изменилась на сервере. Локальный ввод сохранён; сравни версии перед повтором.')
  if (['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error.code ?? '')) {
    return new Error('Не удалось подтвердить доступ к облаку. Проверь вход в аккаунт. Данные на устройстве сохранены.')
  }
  return new Error('Облако не подтвердило сохранение. Данные на устройстве сохранены. Проверь соединение и повтори синхронизацию.')
}
