package app

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"sync/atomic"
	"time"
)

const requestBodyTimeout = 15 * time.Second
const eventWriteTimeout = 10 * time.Second

type trackedBody struct {
	io.ReadCloser
	complete   atomic.Bool
	headers    http.Header
	controller *http.ResponseController
}

func (b *trackedBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if err == io.EOF {
		b.complete.Store(true)
		// HTTP/2 read deadlines can affect a stream after the body finishes.
		// Clear immediately, before a potentially long response/tool call.
		_ = b.controller.SetReadDeadline(time.Time{})
	} else if err != nil {
		b.headers.Set("Connection", "close")
	}
	return n, err
}

// Bound body reads without a global response timeout: SSE and MCP responses may
// legitimately stream for much longer. Cancellation also interrupts a stalled
// network read, allowing server shutdown to release handlers promptly.
func boundBodyRead(w http.ResponseWriter, r *http.Request, timeout time.Duration) func() {
	rc := http.NewResponseController(w)
	body := &trackedBody{ReadCloser: r.Body, headers: w.Header(), controller: rc}
	r.Body = body
	_ = rc.SetReadDeadline(time.Now().Add(timeout))
	finished := make(chan struct{})
	stop := context.AfterFunc(r.Context(), func() {
		if !body.complete.Load() {
			_ = rc.SetReadDeadline(time.Now())
		}
		close(finished)
	})
	return func() {
		if !stop() {
			<-finished
		}
		if body.complete.Load() {
			_ = rc.SetReadDeadline(time.Time{})
		} else {
			// net/http may drain unread bytes when finalizing a buffered
			// response. Do not remove the bound and let that drain stall.
			_ = rc.SetReadDeadline(time.Now())
		}
	}
}

func bodyReadError(err error) error {
	var timeout net.Error
	if errors.As(err, &timeout) && timeout.Timeout() {
		return &APIError{http.StatusRequestTimeout, "Request body read timed out"}
	}
	var oversized *http.MaxBytesError
	if errors.As(err, &oversized) {
		return &APIError{http.StatusRequestEntityTooLarge, "Request body is too large"}
	}
	return invalid("Request body is unreadable")
}
