<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;
use PDOException;
use Throwable;

final class Database
{
    private ?PDO $pdo = null;
    private ?string $lastError = null;

    public function __construct(private readonly array $config)
    {
    }

    public function isConfigured(): bool
    {
        return trim((string)($this->config['host'] ?? '')) !== ''
            && trim((string)($this->config['name'] ?? '')) !== ''
            && trim((string)($this->config['user'] ?? '')) !== '';
    }

    public function connection(): ?PDO
    {
        if (!$this->isConfigured()) {
            return null;
        }
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $host = (string)$this->config['host'];
        $port = (int)($this->config['port'] ?? 3306);
        $name = (string)$this->config['name'];
        $charset = (string)($this->config['charset'] ?? 'utf8mb4');
        $user = (string)$this->config['user'];
        $password = (string)($this->config['password'] ?? '');

        try {
            $this->pdo = new PDO(
                "mysql:host={$host};port={$port};dbname={$name};charset={$charset}",
                $user,
                $password,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES => false,
                    PDO::ATTR_STRINGIFY_FETCHES => false,
                ],
            );
            $this->lastError = null;
            return $this->pdo;
        } catch (PDOException $error) {
            $this->lastError = $error->getMessage();
            return null;
        }
    }

    public function lastError(): ?string
    {
        return $this->lastError;
    }

    public function hasUsableCatalog(string $floorKey = 'comic'): bool
    {
        $pdo = $this->connection();
        if (!$pdo) {
            return false;
        }
        $floorKey = $floorKey === 'amateur' ? 'amateur' : 'comic';

        try {
            $sql = $floorKey === 'amateur'
                ? "SELECT 1 FROM works WHERE floor_key='amateur' AND is_active=1 AND sample_movie_url IS NOT NULL AND sample_movie_url<>'' LIMIT 1"
                : "SELECT 1 FROM works WHERE floor_key='comic' AND is_active=1 AND sample_count>0 LIMIT 1";
            return (bool)$pdo->query($sql)->fetchColumn();
        } catch (Throwable $error) {
            $this->lastError = $error->getMessage();
            return false;
        }
    }
}
