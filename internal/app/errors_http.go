package app

import (
	"context"
	"errors"
	"net/http"
)

// APIError is used only for HTTP protocol failures, not application/storage rules.
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string { return e.Message }

func errorStatus(err error) (int, string) {
	var protocol *APIError
	if errors.As(err, &protocol) {
		return protocol.Status, protocol.Message
	}
	info := classifyError(err)
	switch info.kind {
	case ErrInvalid:
		return http.StatusBadRequest, info.message
	case ErrNotFound:
		return http.StatusNotFound, info.message
	case ErrConflict:
		return http.StatusConflict, info.message
	case ErrUnavailable:
		return http.StatusServiceUnavailable, info.message
	case context.Canceled:
		return http.StatusRequestTimeout, info.message
	default:
		return http.StatusInternalServerError, info.message
	}
}
