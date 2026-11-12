"""Write tvos/CouchTV.xcodeproj from the files in tvos/CouchTV, so the project file never needs hand editing.

    python3 tvos/make-project.py

The result is committed; run this again after adding or removing a Swift file. The scene pictures and the
app logos are not copied into tvos/: a build step copies them from tv-home/web/backgrounds (scene-*, never your
own pictures in mine/) and remote/src/app-logos, so every couch-tv home shows the same ones. Signing settings are not in the project:
they come from tvos/Config/Base.xcconfig and your own Signing.mine.xcconfig (git ignores it).
"""
import hashlib
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
APP = os.path.join(HERE, "CouchTV")
PROJ = os.path.join(HERE, "CouchTV.xcodeproj")
# Copies the scenes and logos into the app at build time, so a new logo needs no project change.
COPY_PICTURES = """set -e
dest="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"
mkdir -p "$dest"
cp "${SRCROOT}/../tv-home/web/backgrounds/"scene-*.jpg "${SRCROOT}/../tv-home/web/backgrounds/"scene-*.webp "$dest/"
cp "${SRCROOT}/../remote/src/app-logos/"*.png "$dest/"
"""


def oid(*parts):
    return hashlib.md5("/".join(parts).encode()).hexdigest()[:24].upper()


def q(s):
    """A pbxproj string: quoted unless it is plain."""
    if s and all(c.isalnum() or c in "._/$" for c in s):
        return s
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def kind(name):
    ext = os.path.splitext(name)[1]
    return {".swift": "sourcecode.swift", ".plist": "text.plist.xml", ".xcconfig": "text.xcconfig",
            ".xcassets": "folder.assetcatalog", ".ttf": "file", ".jpg": "image.jpeg", ".png": "image.png",
            ".webp": "file"}.get(ext, "file")


def main():
    files, groups, build_files = {}, {}, {}
    sources, resources = [], []

    def ref(path, name=None, tree="<group>"):
        i = oid("ref", path)
        files[i] = {"isa": "PBXFileReference", "lastKnownFileType": kind(path), "path": path,
                    "name": name, "sourceTree": tree}
        return i

    def build(ref_id, phase):
        i = oid("build", ref_id)
        build_files[i] = ref_id
        phase.append(i)
        return i

    swift = sorted(f for f in os.listdir(APP) if f.endswith(".swift"))
    app_children = []
    for f in swift:
        r = ref(f)
        app_children.append(r)
        build(r, sources)
    app_children.append(ref("Info.plist"))
    r = ref("Assets.xcassets")
    app_children.append(r)
    build(r, resources)
    font_children = []
    for f in sorted(os.listdir(os.path.join(APP, "Fonts"))):
        if f.endswith(".ttf"):
            r = ref(f)
            font_children.append(r)
            build(r, resources)
    groups[oid("group", "fonts")] = {"name": None, "path": "Fonts", "children": font_children}
    app_children.append(oid("group", "fonts"))
    groups[oid("group", "app")] = {"name": None, "path": "CouchTV", "children": app_children}

    base_cfg = ref("Config/Base.xcconfig", name="Base.xcconfig")
    example_cfg = ref("Config/Signing.example.xcconfig", name="Signing.example.xcconfig")
    groups[oid("group", "config")] = {"name": "Config", "path": None, "children": [base_cfg, example_cfg]}

    product = oid("product")
    files[product] = {"isa": "PBXFileReference", "explicitFileType": "wrapper.application", "includeInIndex": "0",
                      "path": "CouchTV.app", "sourceTree": "BUILT_PRODUCTS_DIR"}
    groups[oid("group", "products")] = {"name": "Products", "path": None, "children": [product]}
    main_group = oid("group", "main")
    groups[main_group] = {"name": None, "path": None, "children": [
        oid("group", "app"), oid("group", "config"), oid("group", "products")]}

    target, project = oid("target"), oid("project")
    p_sources, p_frameworks, p_resources = oid("phase", "sources"), oid("phase", "frameworks"), oid("phase", "resources")
    p_pictures = oid("phase", "pictures")
    cl_project, cl_target = oid("configlist", "project"), oid("configlist", "target")

    common = {
        "ALWAYS_SEARCH_USER_PATHS": "NO", "CLANG_ENABLE_MODULES": "YES", "ENABLE_STRICT_OBJC_MSGSEND": "YES",
        "GCC_NO_COMMON_BLOCKS": "YES", "SDKROOT": "appletvos", "TVOS_DEPLOYMENT_TARGET": "17.0",
        "SWIFT_VERSION": "5.0", "SWIFT_COMPILATION_MODE": "wholemodule", "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
        "LOCALIZATION_PREFERS_STRING_CATALOGS": "YES",
    }
    project_cfg = {
        "Debug": {**common, "DEBUG_INFORMATION_FORMAT": "dwarf", "ONLY_ACTIVE_ARCH": "YES", "ENABLE_TESTABILITY": "YES",
                  "SWIFT_OPTIMIZATION_LEVEL": "-Onone", "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG",
                  "GCC_OPTIMIZATION_LEVEL": "0", "SWIFT_COMPILATION_MODE": "singlefile"},
        "Release": {**common, "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym", "SWIFT_OPTIMIZATION_LEVEL": "-O",
                    "VALIDATE_PRODUCT": "YES"},
    }
    target_cfg = {
        "INFOPLIST_FILE": "CouchTV/Info.plist", "GENERATE_INFOPLIST_FILE": "NO", "PRODUCT_NAME": "CouchTV",
        "TARGETED_DEVICE_FAMILY": "3", "ASSETCATALOG_COMPILER_APPICON_NAME": '"App Icon & Top Shelf Image"',
        "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
        "LD_RUNPATH_SEARCH_PATHS": '"$(inherited) @executable_path/Frameworks"', "SWIFT_EMIT_LOC_STRINGS": "NO",
        "ENABLE_USER_SCRIPT_SANDBOXING": "NO",
    }

    objs = []

    def obj(i, fields, comment=""):
        objs.append((i, fields, comment))

    for i, r in build_files.items():
        obj(i, {"isa": "PBXBuildFile", "fileRef": r})
    for i, f in files.items():
        obj(i, {k: v for k, v in f.items() if v is not None})
    for i, g in groups.items():
        f = {"isa": "PBXGroup", "children": g["children"], "sourceTree": "<group>"}
        if g["name"]:
            f["name"] = g["name"]
        if g["path"]:
            f["path"] = g["path"]
        obj(i, f)
    obj(p_sources, {"isa": "PBXSourcesBuildPhase", "buildActionMask": "2147483647", "files": sources,
                    "runOnlyForDeploymentPostprocessing": "0"})
    obj(p_frameworks, {"isa": "PBXFrameworksBuildPhase", "buildActionMask": "2147483647", "files": [],
                       "runOnlyForDeploymentPostprocessing": "0"})
    obj(p_resources, {"isa": "PBXResourcesBuildPhase", "buildActionMask": "2147483647", "files": resources,
                      "runOnlyForDeploymentPostprocessing": "0"})
    obj(p_pictures, {"isa": "PBXShellScriptBuildPhase", "alwaysOutOfDate": "1", "buildActionMask": "2147483647",
                     "files": [], "inputPaths": [], "outputPaths": [], "name": '"Copy scenes and logos"',
                     "runOnlyForDeploymentPostprocessing": "0", "shellPath": "/bin/sh",
                     "shellScript": '"' + COPY_PICTURES.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"',
                     "showEnvVarsInLog": "0"})
    cfg_ids = {}
    for scope, cfgs in (("project", project_cfg), ("target", {"Debug": target_cfg, "Release": target_cfg})):
        for name, settings in cfgs.items():
            i = oid("config", scope, name)
            cfg_ids.setdefault(scope, []).append(i)
            f = {"isa": "XCBuildConfiguration", "buildSettings": settings, "name": name}
            if scope == "project":
                f["baseConfigurationReference"] = base_cfg
            obj(i, f)
    obj(cl_project, {"isa": "XCConfigurationList", "buildConfigurations": cfg_ids["project"],
                     "defaultConfigurationIsVisible": "0", "defaultConfigurationName": "Release"})
    obj(cl_target, {"isa": "XCConfigurationList", "buildConfigurations": cfg_ids["target"],
                    "defaultConfigurationIsVisible": "0", "defaultConfigurationName": "Release"})
    obj(target, {"isa": "PBXNativeTarget", "buildConfigurationList": cl_target,
                 "buildPhases": [p_sources, p_frameworks, p_resources, p_pictures], "buildRules": [], "dependencies": [],
                 "name": "CouchTV", "productName": "CouchTV", "productReference": product,
                 "productType": '"com.apple.product-type.application"'})
    obj(project, {"isa": "PBXProject", "attributes": {"BuildIndependentTargetsInParallel": "1",
                                                      "LastSwiftUpdateCheck": "2600", "LastUpgradeCheck": "2600"},
                  "buildConfigurationList": cl_project, "compatibilityVersion": '"Xcode 14.0"',
                  "developmentRegion": "en", "hasScannedForEncodings": "0", "knownRegions": ["en", "Base"],
                  "mainGroup": main_group, "productRefGroup": oid("group", "products"), "projectDirPath": '""',
                  "projectRoot": '""', "targets": [target]})

    def val(v, ind):
        if isinstance(v, dict):
            inner = "".join(f"{ind}\t{k_(k)} = {val(x, ind + chr(9))};\n" for k, x in v.items())
            return "{\n" + inner + ind + "}"
        if isinstance(v, list):
            inner = "".join(f"{ind}\t{val(x, ind + chr(9))},\n" for x in v)
            return "(\n" + inner + ind + ")"
        s = str(v)
        return s if s.startswith('"') else q(s)

    def k_(k):
        return q(k)

    out = ["// !$*UTF8*$!", "{", "\tarchiveVersion = 1;", "\tclasses = {", "\t};", "\tobjectVersion = 56;", "\tobjects = {"]
    for isa in sorted({f["isa"] for _, f, _ in objs}):
        out.append(f"\n/* Begin {isa} section */")
        for i, f, _ in sorted((o for o in objs if o[1]["isa"] == isa), key=lambda o: o[0]):
            out.append(f"\t\t{i} = {val(f, chr(9) * 2)};")
        out.append(f"/* End {isa} section */")
    out += ["\t};", f"\trootObject = {project};", "}", ""]
    os.makedirs(PROJ, exist_ok=True)
    with open(os.path.join(PROJ, "project.pbxproj"), "w") as fh:
        fh.write("\n".join(out))

    scheme_dir = os.path.join(PROJ, "xcshareddata", "xcschemes")
    os.makedirs(scheme_dir, exist_ok=True)
    entry = (f'<BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{target}" '
             f'BuildableName = "CouchTV.app" BlueprintName = "CouchTV" ReferencedContainer = "container:CouchTV.xcodeproj">'
             f'</BuildableReference>')
    with open(os.path.join(scheme_dir, "CouchTV.xcscheme"), "w") as fh:
        fh.write(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "2600" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            {entry}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv = "YES">
   </TestAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         {entry}
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration = "Release" shouldUseLaunchSchemeArgsEnv = "YES" savedToolIdentifier = "" useCustomWorkingDirectory = "NO" debugDocumentVersioning = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         {entry}
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
''')
    print("wrote", os.path.relpath(PROJ, ROOT), f"({len(sources)} Swift files, {len(resources)} resources)")


if __name__ == "__main__":
    main()
