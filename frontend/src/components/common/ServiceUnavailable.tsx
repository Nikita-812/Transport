import { Button, Center, Code, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconRefresh, IconServerOff } from '@tabler/icons-react';
import { describeError, SERVICE_UNAVAILABLE_TITLE } from '../../api/errors';

interface ServiceUnavailableProps {
  /** Ошибка запроса `/health`; без неё — сервис ответил `ready: false`. */
  error?: unknown;
  onRetry: () => void;
  retrying: boolean;
}

/** Полноэкранное сообщение без устаревших данных (spec dashboard-shell, «Backend unavailable»). */
export function ServiceUnavailable({ error, onRetry, retrying }: ServiceUnavailableProps) {
  const described =
    error === undefined
      ? { message: 'Сервис запущен, но снимок прогноза ещё не загружен. Повторите попытку через несколько секунд.', details: undefined }
      : describeError(error);

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder radius="lg" p="xl" maw={520} w="100%" role="alert" aria-live="assertive">
        <Stack align="center" gap="md" ta="center">
          <ThemeIcon size={56} radius="xl" variant="light" color="gray" aria-hidden>
            <IconServerOff size={30} stroke={1.6} />
          </ThemeIcon>
          <Title order={1} size="h2">
            {SERVICE_UNAVAILABLE_TITLE}
          </Title>
          <Text c="dimmed">{described.message}</Text>
          <Button leftSection={<IconRefresh size={18} aria-hidden />} onClick={onRetry} loading={retrying} size="md">
            Повторить
          </Button>
          {described.details && (
            <details style={{ width: '100%', textAlign: 'left' }}>
              <summary>
                <Text span size="sm" c="dimmed">
                  Технические подробности
                </Text>
              </summary>
              <Code block mt="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {described.details}
              </Code>
            </details>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}
