import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

export function createMockVaultFileAdapter(files: Record<string, string> = {}): VaultFileAdapter {
  const filePaths = () => Object.keys(files);
  const withPrefix = (folder: string) => {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return { paths: filePaths(), prefix };
  };

  return {
    exists: jest.fn(async (path: string) =>
      path in files || filePaths().some(filePath => filePath.startsWith(`${path}/`)),
    ),
    read: jest.fn(async (path: string) => {
      if (!(path in files)) throw new Error(`File not found: ${path}`);
      return files[path];
    }),
    write: jest.fn(),
    delete: jest.fn(),
    listFiles: jest.fn(async (folder: string) => {
      const { paths, prefix } = withPrefix(folder);
      return paths.filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
    }),
    listFolders: jest.fn(async (folder: string) => {
      const { paths, prefix } = withPrefix(folder);
      const folders = new Set<string>();
      for (const path of paths) {
        const rest = path.slice(prefix.length);
        const firstSlash = rest.indexOf('/');
        if (firstSlash >= 0) folders.add(prefix + rest.slice(0, firstSlash));
      }
      return Array.from(folders);
    }),
    listFilesRecursive: jest.fn(async (folder: string) => {
      const { paths, prefix } = withPrefix(folder);
      return paths.filter(path => path.startsWith(prefix));
    }),
    ensureFolder: jest.fn(),
    rename: jest.fn(),
    append: jest.fn(),
    stat: jest.fn(),
    deleteFolder: jest.fn(),
  } as unknown as VaultFileAdapter;
}
