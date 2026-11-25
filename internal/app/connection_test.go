package app

import (
	"context"
	"database/sql/driver"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestConnectionSettingsSurviveReplacement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "private ? # database.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	check := func() {
		t.Helper()
		for name, want := range map[string]int{"foreign_keys": 1, "busy_timeout": 5000} {
			var got int
			if err := s.db.QueryRow("PRAGMA " + name).Scan(&got); err != nil || got != want {
				t.Fatalf("%s = %d, want %d: %v", name, got, want, err)
			}
		}
		if _, err := s.db.Exec("INSERT INTO epics(project_id,title) VALUES(999,'orphan')"); err == nil {
			t.Fatal("foreign key violation accepted")
		}
	}
	check()
	conn, err := s.db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.Raw(func(any) error { return driver.ErrBadConn }); err != driver.ErrBadConn {
		t.Fatal(err)
	}
	_ = conn.Close()
	check()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatalf("database mode: %v", info.Mode())
	}
}

func TestMemoryConnectionSettings(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var enabled int
	if err := s.db.QueryRow("PRAGMA foreign_keys").Scan(&enabled); err != nil || enabled != 1 {
		t.Fatalf("foreign_keys: %d %v", enabled, err)
	}
}
