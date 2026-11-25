package buildinfo

import (
	"runtime/debug"
	"strings"
)

// Version and Revision may be set with go build -ldflags -X. Empty values use
// Go's module/VCS build metadata; untagged source builds report dev.
var Version string
var Revision string

type Info struct {
	Version  string
	Revision string
	Modified bool
}

func Current() Info {
	build, _ := debug.ReadBuildInfo()
	return resolve(Version, Revision, build)
}

func resolve(version, revision string, build *debug.BuildInfo) Info {
	out := Info{Version: version, Revision: revision}
	if build != nil {
		sourceBuild := false
		for _, setting := range build.Settings {
			switch setting.Key {
			case "vcs":
				sourceBuild = true
			case "vcs.revision":
				sourceBuild = true
				if out.Revision == "" {
					out.Revision = setting.Value
				}
			case "vcs.modified":
				out.Modified = setting.Value == "true"
			}
		}
		// Some Go toolchains synthesize a pseudo-version for checkout builds.
		// Only a versioned module install supplies the default release identity;
		// checkout release builds use the explicit linker override.
		if out.Version == "" && !sourceBuild && build.Main.Version != "(devel)" {
			out.Version = build.Main.Version
		}
	}
	if out.Version == "" {
		out.Version = "dev"
	}
	return out
}

func (i Info) String() string {
	text := "tinytickets " + i.Version
	var details []string
	if i.Revision != "" {
		details = append(details, "revision "+i.Revision)
	}
	if i.Modified {
		details = append(details, "modified")
	}
	if len(details) > 0 {
		text += " (" + strings.Join(details, ", ") + ")"
	}
	return text
}
