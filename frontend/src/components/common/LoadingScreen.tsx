import { Center, Loader, Stack, Text } from '@mantine/core';

export function LoadingScreen() {
  return (
    <Center mih="100vh" p="md">
      <Stack align="center" gap="sm" role="status" aria-live="polite">
        <Loader size="lg" aria-hidden />
        <Text c="dimmed">Подключение к сервису прогнозов…</Text>
      </Stack>
    </Center>
  );
}
