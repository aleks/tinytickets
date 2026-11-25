package buildinfo

import (
	"runtime/debug"
	"testing"
)

func TestResolveBuildIdentity(t *testing.T) {
	for _, tc := range []struct {
		name, version, revision string
		build                   *debug.BuildInfo
		want                    Info
		text                    string
	}{
		{"no metadata", "", "", nil, Info{Version: "dev"}, "tinytickets dev"},
		{"source", "", "", &debug.BuildInfo{Main: debug.Module{Version: "(devel)"}}, Info{Version: "dev"}, "tinytickets dev"},
		{"installed module", "", "", &debug.BuildInfo{Main: debug.Module{Version: "v0.2.0"}}, Info{Version: "v0.2.0"}, "tinytickets v0.2.0"},
		{"source revision", "", "", &debug.BuildInfo{Settings: []debug.BuildSetting{{Key: "vcs.revision", Value: "abc123"}, {Key: "vcs.modified", Value: "true"}}}, Info{Version: "dev", Revision: "abc123", Modified: true}, "tinytickets dev (revision abc123, modified)"},
		{"source pseudo-version", "", "", &debug.BuildInfo{Main: debug.Module{Version: "v0.0.0-20260101000000-abc123+dirty"}, Settings: []debug.BuildSetting{{Key: "vcs.revision", Value: "abc123"}, {Key: "vcs.modified", Value: "true"}}}, Info{Version: "dev", Revision: "abc123", Modified: true}, "tinytickets dev (revision abc123, modified)"},
		{"release override", "v0.3.0", "release-revision", &debug.BuildInfo{Main: debug.Module{Version: "v0.2.0"}, Settings: []debug.BuildSetting{{Key: "vcs.revision", Value: "source-revision"}}}, Info{Version: "v0.3.0", Revision: "release-revision"}, "tinytickets v0.3.0 (revision release-revision)"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := resolve(tc.version, tc.revision, tc.build)
			if got != tc.want || got.String() != tc.text {
				t.Fatal(got, got.String())
			}
		})
	}
}
