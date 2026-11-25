package app

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestOrdinaryMutationsAcrossStores(t *testing.T) {
	path := filepath.Join(t.TempDir(), "writes.db")
	a, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	p, e, first := seed(t, New(a))
	second := create(t, New(a), "tickets", Input{EpicID: &e, Title: ptr("Second")})
	b, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	for _, s := range []*Store{a, b} {
		wg.Add(1)
		go func(s *Store) {
			defer wg.Done()
			for range 100 {
				if _, err := s.Mutate(ctx, "projects", "update", p, Input{Name: ptr("updated")}); err != nil {
					t.Errorf("update: %v", err)
					return
				}
			}
		}(s)
	}
	wg.Wait()
	results := make(chan error, 2)
	go func() {
		_, err := a.Mutate(ctx, "links", "create", 0, Input{BlockerID: first, BlockedID: second})
		results <- err
	}()
	go func() {
		_, err := b.Mutate(ctx, "links", "create", 0, Input{BlockerID: second, BlockedID: first})
		results <- err
	}()
	success := 0
	for range 2 {
		if err := <-results; err == nil {
			success++
		} else if code, _ := errorStatus(err); code != 400 {
			t.Fatal(err)
		}
	}
	if success != 1 {
		t.Fatalf("opposing dependencies: %d succeeded", success)
	}
}

func TestWriteTransactionCleanup(t *testing.T) {
	a := testApp(t)
	ctx, cancel := context.WithCancel(context.Background())
	tx, err := beginWrite(ctx, a.Store.db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO projects(name) VALUES('rollback')"); err != nil {
		t.Fatal(err)
	}
	cancel()
	if err := tx.Commit(); !errors.Is(err, context.Canceled) {
		t.Fatalf("commit: %v", err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	state, err := a.Store.Snapshot(context.Background())
	if err != nil || len(state.Projects) != 0 {
		t.Fatal(state, err)
	}
	create(t, a, "projects", Input{Name: ptr("connection reusable")})
}

func TestMutationProcessHelper(t *testing.T) {
	path := os.Getenv("TINYTICKETS_MUTATION_TEST_DB")
	if path == "" {
		return
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	for range 100 {
		if _, err := s.Mutate(ctx, "projects", "update", 1, Input{Name: ptr("process update")}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestOrdinaryMutationsAcrossProcesses(t *testing.T) {
	path := filepath.Join(t.TempDir(), "process.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	seed(t, New(s))
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	for range 3 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestMutationProcessHelper$")
			cmd.Env = append(os.Environ(), "TINYTICKETS_MUTATION_TEST_DB="+path)
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Errorf("mutation process: %v %s", err, out)
			}
		}()
	}
	wg.Wait()
}
