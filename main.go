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

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"tinytickets/internal/app"
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
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dbPath := flag.String("db", filepath.Join(home, ".tinytickets", "tinytickets.db"), "SQLite database path")
	addr := flag.String("addr", "127.0.0.1:8080", "HTTP listen address")
	stdio := flag.Bool("mcp-stdio", false, "Run only the MCP stdio server (no HTTP)")
	flag.Parse()
	if strings.HasPrefix(*dbPath, "~/") {
		*dbPath = filepath.Join(home, (*dbPath)[2:])
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
	go a.WatchDatabase(ctx)
	handler := a.Handler(assets)
	listenHost, _, err := net.SplitHostPort(*addr)
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
			http.Error(w, "Host not allowed", 403)
			return
		}
		handler.ServeHTTP(w, r)
	})
	server := &http.Server{Addr: *addr, Handler: guarded, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, BaseContext: func(net.Listener) context.Context { return ctx }}
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	slog.Info("TinyTickets", "url", "http://"+listener.Addr().String(), "database", *dbPath, "mcp", "/mcp")
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
