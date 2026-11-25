package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/aleks/tinytickets/internal/app"
	"github.com/aleks/tinytickets/internal/buildinfo"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

//go:embed all:web/dist
var frontend embed.FS

func main() {
	if err := run(); err != nil {
		slog.Error(err.Error())
		os.Exit(1)
	}
}

func run() error {
	dbPath := flag.String("db", "", "SQLite database path (default ~/.tinytickets/tinytickets.db)")
	addr := flag.String("addr", "127.0.0.1:8080", "HTTP listen address")
	stdio := flag.Bool("mcp-stdio", false, "Run only the MCP stdio server (no HTTP)")
	showVersion := flag.Bool("version", false, "Print version and build revision without opening a database")
	flag.Parse()
	if *showVersion {
		fmt.Fprintln(os.Stdout, buildinfo.Current().String())
		return nil
	}
	if *dbPath == "" || strings.HasPrefix(*dbPath, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		if *dbPath == "" {
			*dbPath = filepath.Join(home, ".tinytickets", "tinytickets.db")
		} else {
			*dbPath = filepath.Join(home, (*dbPath)[2:])
		}
	}
	store, err := app.Open(*dbPath)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer store.Close()
	a := app.New(store)
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if *stdio {
		return a.MCP.Run(ctx, &mcp.StdioTransport{})
	}
	assets, err := fs.Sub(frontend, "web/dist")
	if err != nil {
		return err
	}
	return serveHTTP(ctx, a, assets, *addr, *dbPath)
}

func serveHTTP(ctx context.Context, a *app.App, assets fs.FS, addr, dbPath string) error {
	watchCtx, cancelWatch := context.WithCancel(ctx)
	watchDone := make(chan struct{})
	go func() { defer close(watchDone); a.WatchDatabase(watchCtx) }()
	defer func() { cancelWatch(); <-watchDone }()
	handler := a.Handler(assets)
	listenHost, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	loopback := listenHost == "localhost" || net.ParseIP(listenHost).IsLoopback()
	if !loopback {
		slog.Warn("No authentication is configured. Only expose TinyTickets on trusted networks.")
	}
	// Reject DNS rebinding against a local-only server.
	guarded := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			host = r.Host
		}
		if loopback && host != "localhost" && !net.ParseIP(host).IsLoopback() {
			http.Error(w, "Host not allowed", http.StatusForbidden)
			return
		}
		handler.ServeHTTP(w, r)
	})
	// Bound even requests rejected by the Host guard. Do not set a global
	// WriteTimeout: SSE and MCP responses may legitimately be long-lived.
	server := &http.Server{Addr: addr, Handler: guarded, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, BaseContext: func(net.Listener) context.Context { return ctx }}
	defer server.Close()
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	slog.Info("TinyTickets", "url", "http://"+listener.Addr().String(), "database", dbPath, "mcp", "/mcp")
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
			return err
		}
	}
	return nil
}
