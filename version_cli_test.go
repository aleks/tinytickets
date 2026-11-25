package main

import (
	"archive/zip"
	"context"
	"io"
	"io/fs"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const modulePath = "github.com/aleks/tinytickets"

func binaryName() string {
	if runtime.GOOS == "windows" {
		return "tinytickets.exe"
	}
	return "tinytickets"
}

func checkBinaryIdentity(t *testing.T, binary, want string) {
	t.Helper()
	db := filepath.Join(t.TempDir(), "must-not-be-created", "version.db")
	cmd := exec.Command(binary, "--version", "--mcp-stdio", "--db", db)
	out, err := cmd.CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != want {
		t.Fatalf("version: %q %v", out, err)
	}
	if _, err := os.Stat(filepath.Dir(db)); !os.IsNotExist(err) {
		t.Fatal("--version touched database path", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "identity-test", Version: "test"}, nil)
	session, err := client.Connect(ctx, &mcp.CommandTransport{Command: exec.Command(binary, "--mcp-stdio", "--db", filepath.Join(t.TempDir(), "stdio.db"))}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if got := session.InitializeResult().ServerInfo.Version; got != strings.Fields(want)[1] {
		t.Fatalf("MCP version %q differs from CLI %q", got, want)
	}
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "get_workspace", Arguments: map[string]any{}})
	if err != nil || result.IsError {
		t.Fatal("stdio protocol failed", result, err)
	}
}

func TestReleaseBuildIdentity(t *testing.T) {
	binary := filepath.Join(t.TempDir(), binaryName())
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	flags := "-X " + modulePath + "/internal/buildinfo.Version=v0.1.0-test -X " + modulePath + "/internal/buildinfo.Revision=release-revision"
	cmd := exec.CommandContext(ctx, "go", "build", "-trimpath", "-buildvcs=false", "-ldflags", flags, "-o", binary, ".")
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("release build: %v %s", err, out)
	}
	checkBinaryIdentity(t, binary, "tinytickets v0.1.0-test (revision release-revision)")
}

func TestSourceBuildIdentity(t *testing.T) {
	binary := filepath.Join(t.TempDir(), binaryName())
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "go", "build", "-trimpath", "-o", binary, ".")
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0", "GOFLAGS=")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("source build: %v %s", err, out)
	}
	out, err := exec.Command(binary, "--version").CombinedOutput()
	if err != nil || len(strings.Fields(string(out))) < 2 || strings.Fields(string(out))[1] != "dev" {
		t.Fatalf("source version: %q %v", out, err)
	}
	checkBinaryIdentity(t, binary, strings.TrimSpace(string(out)))
}

// Exercise go install <canonical-module>@<version> against a private file proxy.
// No tag is published, no public source revision is fetched, and neither the
// user's GOBIN nor module cache receives the synthetic release.
func TestVersionedInstallFromLocalProxy(t *testing.T) {
	const version = "v0.0.0-installtest"
	root, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	tmp := t.TempDir()
	proxy := filepath.Join(tmp, "proxy")
	versions := filepath.Join(proxy, filepath.FromSlash(modulePath), "@v")
	if err := os.MkdirAll(versions, 0700); err != nil {
		t.Fatal(err)
	}
	mod, err := os.ReadFile("go.mod")
	if err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string][]byte{
		version + ".mod":  mod,
		version + ".info": []byte(`{"Version":"` + version + `","Time":"2026-01-01T00:00:00Z"}`),
		"list":            []byte(version + "\n"),
	} {
		if err := os.WriteFile(filepath.Join(versions, name), content, 0600); err != nil {
			t.Fatal(err)
		}
	}
	file, err := os.Create(filepath.Join(versions, version+".zip"))
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	add := func(path string) error {
		entry, err := archive.Create(modulePath + "@" + version + "/" + filepath.ToSlash(path))
		if err != nil {
			return err
		}
		source, err := os.Open(filepath.Join(root, path))
		if err != nil {
			return err
		}
		defer source.Close()
		_, err = io.Copy(entry, source)
		return err
	}
	for _, path := range []string{"main.go", "go.mod", "go.sum"} {
		if err := add(path); err != nil {
			t.Fatal(err)
		}
	}
	for _, dir := range []string{"internal", "web/dist"} {
		if err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				return nil
			}
			if strings.HasSuffix(path, "_test.go") {
				return nil
			}
			return add(path)
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	cacheOut, err := exec.Command("go", "env", "GOMODCACHE").Output()
	if err != nil {
		t.Fatal(err)
	}
	fileURL := func(path string) string { return (&url.URL{Scheme: "file", Path: filepath.ToSlash(path)}).String() }
	bin := filepath.Join(tmp, "bin")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "go", "install", modulePath+"@"+version)
	cmd.Dir = tmp
	cmd.Env = append(os.Environ(), "GOBIN="+bin, "GOMODCACHE="+filepath.Join(tmp, "modules"),
		"GOPROXY="+fileURL(proxy)+","+fileURL(filepath.Join(strings.TrimSpace(string(cacheOut)), "cache", "download")),
		"GOSUMDB=off", "GOPRIVATE=", "GONOPROXY=", "GONOSUMDB=", "GOENV=off",
		"GOTOOLCHAIN=local", "GOWORK=off", "GOFLAGS=-modcacherw", "CGO_ENABLED=0")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("versioned local install: %v %s", err, out)
	}
	checkBinaryIdentity(t, filepath.Join(bin, binaryName()), "tinytickets "+version)
}
