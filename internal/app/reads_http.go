package app

import (
	"net/http"
	"strconv"
)

func queryValue(r *http.Request, key string) (*string, error) {
	values, ok := r.URL.Query()[key]
	if !ok {
		return nil, nil
	}
	if len(values) != 1 || values[0] == "" {
		return nil, invalid(key + " must occur once and have a value")
	}
	return &values[0], nil
}
func queryID(r *http.Request, key string) (*int64, error) {
	raw, err := queryValue(r, key)
	if err != nil || raw == nil {
		return nil, err
	}
	id, err := strconv.ParseInt(*raw, 10, 64)
	if err != nil || id <= 0 {
		return nil, invalid(key + " must be a positive integer")
	}
	return &id, nil
}
func queryBool(r *http.Request, key string) (*bool, error) {
	raw, err := queryValue(r, key)
	if err != nil || raw == nil {
		return nil, err
	}
	b, err := strconv.ParseBool(*raw)
	if err != nil {
		return nil, invalid(key + " must be true or false")
	}
	return &b, nil
}

func (a *App) listCollectionHTTP(w http.ResponseWriter, r *http.Request, kind string) {
	ctx := r.Context()
	switch kind {
	case "projects":
		out, err := a.Store.Projects(ctx)
		respond(w, out, err, 200)
	case "links":
		out, err := a.Store.Links(ctx)
		respond(w, out, err, 200)
	case "epics":
		project, err := queryID(r, "project_id")
		if err != nil {
			respond(w, nil, err, 0)
			return
		}
		completed, err := queryBool(r, "completed")
		if err != nil {
			respond(w, nil, err, 0)
			return
		}
		archived, err := queryBool(r, "archived")
		if err != nil {
			respond(w, nil, err, 0)
			return
		}
		include, err := queryBool(r, "include_archived")
		if err != nil {
			respond(w, nil, err, 0)
			return
		}
		out, err := a.Store.Epics(ctx, EpicFilter{ProjectID: project, Completed: completed, Archived: archived, IncludeArchived: value(include, false)})
		respond(w, out, err, 200)
	case "tickets":
		epic, err := queryID(r, "epic_id")
		if err != nil {
			respond(w, nil, err, 0)
			return
		}
		status, err := queryValue(r, "status")
		if err != nil {
			respond(w, nil, err, 0)
			return
		}
		include, err := queryBool(r, "include_archived")
		if err != nil {
			respond(w, nil, err, 0)
			return
		}
		out, err := a.Store.Tickets(ctx, TicketFilter{EpicID: epic, Status: status, IncludeArchived: value(include, false)})
		respond(w, out, err, 200)
	}
}

func (a *App) getItemHTTP(w http.ResponseWriter, r *http.Request, kind string, id int64) {
	switch kind {
	case "projects":
		out, err := a.Store.Project(r.Context(), id)
		respond(w, out, err, 200)
	case "epics":
		out, err := a.Store.Epic(r.Context(), id)
		respond(w, out, err, 200)
	case "tickets":
		out, err := a.Store.Ticket(r.Context(), id)
		respond(w, out, err, 200)
	}
}
