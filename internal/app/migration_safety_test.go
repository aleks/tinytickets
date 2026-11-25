package app

import (
	"bytes"
	"database/sql"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestUnsupportedDatabaseIsUntouched(t *testing.T) {
	path := filepath.Join(t.TempDir(), "future.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE future_only(value TEXT); INSERT INTO future_only VALUES('preserve'); PRAGMA user_version=99"); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if s, err := Open(path); err == nil {
		s.Close()
		t.Fatal("unsupported database accepted")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("unsupported database contents changed")
	}
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		if _, err := os.Stat(path + suffix); !os.IsNotExist(err) {
			t.Fatalf("unexpected SQLite sidecar %s: %v", suffix, err)
		}
	}
}

func TestInitializationRollsBackOnFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "invalid.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// Collide with a base-schema index after earlier DDL has executed.
	if _, err := db.Exec("CREATE TABLE tickets_epic(value TEXT); PRAGMA user_version=1"); err != nil {
		t.Fatal(err)
	}
	if s, err := Open(path); err == nil {
		s.Close()
		t.Fatal("expected migration failure")
	}
	var count, version int
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE name IN ('projects','epics','tickets','links')").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if count != 0 || version != 1 {
		t.Fatalf("partial migration: %d tables, version %d", count, version)
	}
}

func TestConcurrentDatabaseInitialization(t *testing.T) {
	path := filepath.Join(t.TempDir(), "startup.db")
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s, err := Open(path)
			if err != nil {
				t.Errorf("concurrent open: %v", err)
				return
			}
			defer s.Close()
			var version int
			if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != supportedSchemaVersion {
				t.Errorf("version: %d %v", version, err)
			}
		}()
	}
	wg.Wait()
}
