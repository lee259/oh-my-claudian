import * as fs from 'node:fs/promises';
import * as os from 'node:os';

import * as path from 'path';

import {
  deriveCodexMemoriesDirFromSessionsRoot,
  deriveCodexSessionsRootFromSessionPath,
  findCodexSessionFileAsync,
  parseCodexSessionContent,
  parseCodexSessionFile,
  parseCodexSessionTurns,
  readCodexSessionModel,
} from '@/providers/codex/history/CodexHistoryStore';
import { formatCodexQuestionReply } from '@/providers/codex/normalization/codexQuestionNormalization';
import { appendBrowserContext } from '@/utils/browser';
import { appendContextFiles, appendCurrentNote } from '@/utils/context';
import { appendEditorContext } from '@/utils/editor';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

describe('CodexHistoryStore', () => {
  describe('Stop hook replay', () => {
    const jsonl = (records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n');

    it('keeps both replies around a Stop hook and hides the synthetic hook prompt', () => {
      const messages = parseCodexSessionContent(jsonl([
        { type: 'event_msg', payload: { type: 'task_started', turn_id: 'stop-turn' } },
        { type: 'response_item', payload: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: '<hook_prompt hook_run_id="stop:0:check">Run the focused tests.</hook_prompt>',
          }],
        } },
        { type: 'event_msg', payload: { type: 'agent_message', message: 'Initial answer.' } },
        { type: 'event_msg', payload: { type: 'item_completed', item: {
          type: 'HookPrompt',
          id: 'hook-1',
          fragments: [{ hookRunId: 'stop:0:check', text: 'Run the focused tests.' }],
        } } },
        { type: 'event_msg', payload: { type: 'agent_message', message: 'Tests passed.' } },
        { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'stop-turn' } },
      ]));

      expect(messages.filter(message => message.role === 'user')).toEqual([]);
      expect(messages.find(message => message.role === 'assistant')?.contentBlocks).toEqual([
        { type: 'text', content: 'Initial answer.' },
        { type: 'stop_hook', content: 'Run the focused tests.' },
        { type: 'text', content: 'Tests passed.' },
      ]);
    });
  });

  describe('historical model labels', () => {
    const turn = (id: string, model: unknown) => [
      { type: 'event_msg', payload: { type: 'task_started', turn_id: id } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `Question ${id}` }] } },
      { type: 'turn_context', payload: { turn_id: id, model } },
      { type: 'event_msg', payload: { type: 'agent_message', message: `Answer ${id}` } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: id } },
    ];
    const jsonl = (records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n');

    it('restores the model of each native turn across a model switch', () => {
      const messages = parseCodexSessionContent(jsonl([
        ...turn('first', 'gpt-6-luna'), ...turn('second', 'gpt-6.1-terra'),
      ]));
      expect(messages.filter(message => message.role === 'assistant')).toEqual([
        expect.objectContaining({ content: 'Answer first', modelName: 'GPT-6 Luna' }),
        expect.objectContaining({ content: 'Answer second', modelName: 'GPT-6.1 Terra' }),
      ]);
      expect(messages.filter(message => message.role === 'user').map(message => message.modelName)).toEqual([undefined, undefined]);
    });

    it.each([undefined, null, 42, '', '   '])('does not borrow a previous model when turn metadata is invalid: %s', model => {
      const messages = parseCodexSessionContent(jsonl([...turn('first', 'gpt-6-luna'), ...turn('second', model)]));
      expect(messages.filter(message => message.role === 'assistant').map(message => message.modelName)).toEqual(['GPT-6 Luna', undefined]);
    });

    it('keeps unknown native model names without consulting the current catalog', () => {
      const messages = parseCodexSessionContent(jsonl(turn('custom', '  local-model-v2  ')));
      expect(messages.find(message => message.role === 'assistant')?.modelName).toBe('local-model-v2');
    });

    it('associates late context by native turn identity rather than the current turn', () => {
      const first = turn('first', 'gpt-6-luna');
      const second = turn('second', 'gpt-6.1-terra');
      const messages = parseCodexSessionContent(jsonl([
        ...first, ...second.slice(0, 3),
        { type: 'turn_context', payload: { turn_id: 'first', model: 'corrected-first-model' } },
        ...second.slice(3),
      ]));
      expect(messages.filter(message => message.role === 'assistant').map(message => message.modelName))
        .toEqual(['corrected-first-model', 'GPT-6.1 Terra']);
    });

    it('recovers context recorded before its native turn starts', () => {
      const records = turn('first', 'gpt-6-luna');
      const messages = parseCodexSessionContent(jsonl([records[2], ...records.slice(0, 2), ...records.slice(3)]));
      expect(messages.find(message => message.role === 'assistant')?.modelName).toBe('GPT-6 Luna');
    });

    it('uses id-less context only for the active turn', () => {
      const records = turn('first', 'gpt-6-luna');
      const messages = parseCodexSessionContent(jsonl([
        ...records.slice(0, 2), { type: 'turn_context', payload: { model: 'gpt-6-luna' } }, ...records.slice(3),
        ...turn('second', undefined),
      ]));
      expect(messages.filter(message => message.role === 'assistant').map(message => message.modelName)).toEqual(['GPT-6 Luna', undefined]);
    });

    it.each([null, 42, '', '   '])('does not treat malformed turn identity as id-less context: %s', turnId => {
      const records = turn('first', 'gpt-6-luna');
      const messages = parseCodexSessionContent(jsonl([
        ...records.slice(0, 2), { type: 'turn_context', payload: { turn_id: turnId, model: 'gpt-6-luna' } }, ...records.slice(3),
      ]));
      expect(messages.find(message => message.role === 'assistant')?.modelName).toBeUndefined();
    });

    it('preserves the recorded model on an interrupted turn without a completion record', () => {
      const messages = parseCodexSessionContent(jsonl([
        ...turn('first', 'gpt-6-luna').slice(0, -1), { type: 'event_msg', payload: { type: 'turn_aborted' } },
      ]));
      expect(messages.find(message => message.role === 'assistant')).toMatchObject({ modelName: 'GPT-6 Luna', isInterrupt: true });
    });

    it('does not use models from beyond the requested history checkpoint', () => {
      const turns = parseCodexSessionTurns(jsonl([...turn('first', 'gpt-6-luna'), ...turn('second', 'gpt-6.1-terra')]), 'first');
      expect(turns).toHaveLength(1);
      expect(turns[0].messages.find(message => message.role === 'assistant')?.modelName).toBe('GPT-6 Luna');
    });
  });

  describe('input context replay', () => {
    const replay = (prompt: string, event = false) => parseCodexSessionContent(JSON.stringify(event
      ? { type: 'event_msg', payload: { type: 'user_message', message: prompt } }
      : { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] } }));

    it.each([false, true])('restores attached files and the sent selection snapshot from native input (event=%s)', event => {
      const notePath = 'Notes/A & "B" <draft>.md';
      const selectedText = '  Original passage\n</editor_selection>\n]]>\n<context_files><context_file path="fake.md" /></context_files>\n';
      const prompt = appendContextFiles(appendEditorContext(appendCurrentNote('Explain this', notePath), {
        notePath, mode: 'selection', selectedText, startLine: 70, lineCount: 5,
      }), [notePath, 'Notes/reference.md', 'Notes/reference.md']);
      const messages = replay(prompt, event);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ content: prompt, displayContent: 'Explain this', executionInput: {
        schemaVersion: 1, canonicalText: 'Explain this', context: {
          currentNote: { path: notePath }, contextFiles: [notePath, 'Notes/reference.md'],
          editorSelection: { mode: 'selection', notePath, selectedText, startLine: 70, lineCount: 5 },
        },
      } });
    });

    it('restores browser selections using their recorded source and text', () => {
      const browser = { source: 'browser', title: 'A & B', url: 'https://example.com/?a=1&b=2', selectedText: '<original>\n  browser selection' };
      expect(replay(appendBrowserContext('Explain', browser))[0].executionInput?.context?.browserSelection).toEqual(browser);
    });

    it.each([
      'Example\n\n```xml\n<linked_note path="literal.md" />\n```',
      'Example\n\n    <linked_note path="literal.md" />',
      'Example\n\n<context_files>\n<context_file path="broken.md" />',
      'Example\n\n<linked_note path="a.md" path="b.md" />',
    ])('does not infer context from literal or malformed metadata: %s', prompt => {
      expect(replay(prompt)[0].executionInput).toBeUndefined();
      expect(replay(prompt)[0].content).toBe(prompt);
    });

    it('does not carry attachments into the following user turn', () => {
      const messages = parseCodexSessionContent([
        { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: appendCurrentNote('First', 'first.md') }] } },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Second' }] } },
      ].map(record => JSON.stringify(record)).join('\n'));
      expect(messages[0].executionInput?.context?.currentNote).toEqual({ path: 'first.md' });
      expect(messages[1].executionInput).toBeUndefined();
    });

    it('ignores literal metadata in code while recovering the real appended context', () => {
      const body = 'Example\n\n```xml\n<linked_note path="literal.md" />\n```';
      const message = replay(appendCurrentNote(body, 'real.md'))[0];
      expect(message.executionInput).toEqual({ schemaVersion: 1, canonicalText: body, context: { currentNote: { path: 'real.md' } } });
    });

    it.each(['70-12', '0-5', '9007199254740992-9007199254740993', 'unknown'])('does not invent line locations for an invalid range: %s', lines => {
      const prompt = `Explain\n\n<editor_selection path="note.md" lines="${lines}">\n<![CDATA[Original]]>\n</editor_selection>`;
      expect(replay(prompt)[0].executionInput?.context?.editorSelection).toEqual({ notePath: 'note.md', mode: 'selection', selectedText: 'Original' });
    });

    it('keeps input images alongside recovered file context', () => {
      const prompt = appendContextFiles('Inspect', ['reference.md']);
      const message = parseCodexSessionContent(JSON.stringify({ type: 'response_item', payload: {
        type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: 'data:image/png;base64,YQ==' }],
      } }))[0];
      expect(message.images).toEqual([expect.objectContaining({ data: 'YQ==', mediaType: 'image/png' })]);
      expect(message.executionInput?.context?.contextFiles).toEqual(['reference.md']);
    });

    it('keeps context-only messages and decodes attribute entities once', () => {
      const message = replay(appendContextFiles('', ['Notes/&amp;value.md']))[0];
      expect(message.executionInput).toEqual({ schemaVersion: 1, canonicalText: '', context: { contextFiles: ['Notes/&amp;value.md'] } });
    });
  });

  describe('native image replay', () => {
    const replay = (records: unknown[]) => parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'))
      .flatMap(message => message.toolCalls ?? []);

    it('adds distinct display names for generated and viewed images without renaming tools', () => {
      const tools = replay([
        { type: 'response_item', payload: { type: 'function_call', name: 'view_image', call_id: 'view', arguments: '{"path":"/tmp/a.png"}' } },
        { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'ImageView', id: 'native-view', path: '/tmp/a.png' } } },
        { type: 'event_msg', payload: { type: 'item_completed', item: {
          type: 'Extension', kind: 'image_gen.generation', id: 'generate', status: 'completed', savedPath: '/tmp/b.png',
        } } },
      ]);
      expect(tools).toEqual([
        expect.objectContaining({ id: 'view', name: 'Read', presentation: { name: 'ViewImage' } }),
        expect.objectContaining({ id: 'generate', name: 'image_gen__imagegen', presentation: { name: 'GenerateImage' } }),
      ]);
    });

    it('restores generated images from native records even inside an opaque script', () => {
      const image = (id: string) => ({ type: 'event_msg', payload: { type: 'item_completed', item: {
        type: 'Extension', kind: 'image_gen.generation', id, status: 'completed',
        revisedPrompt: 'A technical diagram', savedPath: `/tmp/${id}.png`, result: null,
      } } });
      const tools = replay([
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'script',
          input: 'const prompt = getPrompt(); await tools.image_gen__imagegen({prompt});' } },
        image('image-1'), image('image-1'), image('image-2'),
      ]);
      expect(tools.filter(tool => tool.name === 'image_gen__imagegen')).toEqual([
        expect.objectContaining({ id: 'image-1', status: 'completed', resultImages: [{ kind: 'file', path: '/tmp/image-1.png' }] }),
        expect.objectContaining({ id: 'image-2', status: 'completed', resultImages: [{ kind: 'file', path: '/tmp/image-2.png' }] }),
      ]);
    });

    it.each(['before', 'after'])('attaches native image previews %s raw output without duplicating calls', order => {
      const native = { type: 'event_msg', payload: { type: 'item_completed', item: {
        type: 'ImageView', id: 'native-view', path: 'file:///tmp/view.png',
      } } };
      const tools = replay([
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'view',
          input: 'const result = await tools.view_image({path:"/tmp/view.png"}); image(result.image_url);' } },
        ...(order === 'before' ? [native] : []),
        { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'view', output: 'Script completed\nOutput:\n' } },
        ...(order === 'after' ? [native] : []),
      ]);
      expect(tools).toEqual([expect.objectContaining({
        id: 'view', name: 'Read', status: 'completed', resultImages: [{ kind: 'file', path: '/tmp/view.png' }],
      })]);
    });

    it('keeps generation failures authoritative over later script output', () => {
      const tools = replay([
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'generate',
          input: 'text(await tools.image_gen__imagegen({prompt:"diagram"}));' } },
        { type: 'event_msg', payload: { type: 'item_completed', item: {
          type: 'Extension', kind: 'image_gen.generation', id: 'failed-generation', revisedPrompt: 'diagram',
          status: 'failed', failure: 'Generation failed', savedPath: '/tmp/incomplete.png',
        } } },
        { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'generate', output: 'Script completed\nOutput:\n' } },
      ]);
      expect(tools).toEqual([expect.objectContaining({ id: 'generate', status: 'error', result: 'Generation failed' })]);
      expect(tools[0].resultImages).toBeUndefined();
    });

    it.each(['before', 'after'])('preserves embedded view images when native completion arrives %s output', order => {
      const native = { type: 'event_msg', payload: { type: 'item_completed', item: {
        type: 'ImageView', id: 'native-view', path: '/removed/view.png',
      } } };
      const tools = replay([
        { type: 'response_item', payload: { type: 'function_call', name: 'view_image', call_id: 'view',
          arguments: '{"path":"/removed/view.png"}' } },
        ...(order === 'before' ? [native] : []),
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'view',
          output: [{ type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' }] } },
        ...(order === 'after' ? [native] : []),
      ]);
      expect(tools).toHaveLength(1);
      expect(tools[0].resultImages).toEqual([{ kind: 'data', data: 'aGVsbG8=', mediaType: 'image/png' }]);
    });

    it('keeps direct view_image output images attached to the view call', () => {
      const tools = replay([
        { type: 'response_item', payload: { type: 'function_call', name: 'view_image', call_id: 'view',
          arguments: '{"path":"/tmp/view.png"}' } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'view',
          output: [{ type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' }] } },
      ]);
      expect(tools[0].resultImages).toEqual([{ kind: 'data', data: 'aGVsbG8=', mediaType: 'image/png' }]);
    });

    it('associates parallel image views by path rather than completion order', () => {
      const native = (id: string, imagePath: string) => ({ type: 'event_msg', payload: { type: 'item_completed', item: {
        type: 'ImageView', id, path: imagePath,
      } } });
      const tools = replay([
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'views',
          input: 'await tools.view_image({path:"/tmp/a.png"}); await tools.view_image({path:"/tmp/b.png"});' } },
        native('second', 'file:///tmp/b.png'), native('first', '/tmp/a.png'),
      ]);
      expect(tools.filter(tool => tool.name === 'Read')).toEqual([
        expect.objectContaining({ id: 'views:1', resultImages: [{ kind: 'file', path: '/tmp/a.png' }] }),
        expect.objectContaining({ id: 'views:2', resultImages: [{ kind: 'file', path: '/tmp/b.png' }] }),
      ]);
    });

    it.each(['iVBORw0KGgoAAAANSUhEUg==', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='])(
      'replays embedded generation data when the original file is unavailable: %s', result => {
        const tools = replay([{ type: 'event_msg', payload: { type: 'item_completed', item: {
          type: 'Extension', kind: 'image_gen.generation', id: 'generated', status: 'completed', result,
          savedPath: '/removed/generated.png',
        } } }]);
        expect(tools[0].resultImages).toEqual([{ kind: 'data', data: 'iVBORw0KGgoAAAANSUhEUg==', mediaType: 'image/png' }]);
      },
    );

    it.each(['https://example.com/image.png', 'javascript:alert(1)', 'file://%', 'relative.png'])(
      'does not treat an invalid or nonlocal native image path as a preview: %s', imagePath => {
        const tools = replay([{ type: 'event_msg', payload: { type: 'item_completed', item: {
          type: 'ImageView', id: 'view', path: imagePath,
        } } }]);
        expect(tools[0].resultImages).toBeUndefined();
      },
    );

    it('does not assign an ambiguous native result to one of two identical requests', () => {
      const tools = replay([
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'generate',
          input: 'await tools.image_gen__imagegen({prompt:"diagram"}); await tools.image_gen__imagegen({prompt:"diagram"});' } },
        { type: 'event_msg', payload: { type: 'item_completed', item: {
          type: 'Extension', kind: 'image_gen.generation', id: 'native', status: 'completed',
          revisedPrompt: 'diagram', savedPath: '/tmp/native.png',
        } } },
      ]);
      expect(tools.filter(tool => tool.resultImages?.length).map(tool => tool.id)).toEqual(['native']);
    });

    it('does not associate native images with requests from a previous turn', () => {
      const tools = replay([
        { type: 'response_item', payload: { type: 'function_call', name: 'view_image', call_id: 'old', arguments: '{"path":"/tmp/view.png"}' } },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue' }] } },
        { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'ImageView', id: 'new', path: '/tmp/view.png' } } },
      ]);
      expect(tools.filter(tool => tool.resultImages?.length).map(tool => tool.id)).toEqual(['new']);
    });

    it('does not expose a cancelled generation as a completed preview', () => {
      const tools = replay([{ type: 'event_msg', payload: { type: 'item_completed', item: {
        type: 'Extension', kind: 'image_gen.generation', id: 'cancelled', status: 'cancelled', savedPath: '/tmp/partial.png',
      } } }]);
      expect(tools[0]).toMatchObject({ status: 'cancelled' });
      expect(tools[0].resultImages).toBeUndefined();
    });
  });

  describe('image generation script output deduplication', () => {
    const generated = (id: string, status = 'completed') => ({
      type: 'event_msg', payload: { type: 'item_completed', item: {
        type: 'Extension', kind: 'image_gen.generation', id, status,
        savedPath: `/tmp/${id}.png`, result: 'data:image/png;base64,YQ==',
      } },
    });
    const script = { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'script',
      input: 'const prompt = getPrompt(); await tools.image_gen__imagegen({prompt});' } };
    const hint = (id: string) => [
      `Generated images are saved to /tmp as /tmp/${id}.png by default.`,
      'If you need to use a generated image at another path, copy it and leave the original in place unless the user explicitly asks you to delete it.',
      'The generated image is already displayed to the user. There is no need to render it in the final response as a Markdown image or file link.',
    ].join('\n');
    const output = (value: unknown, header = 'Script completed') => ({
      type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'script', output:
        [{ type: 'input_text', text: `${header}\nWall time 1.0 seconds\nOutput:\n` },
          { type: 'input_text', text: JSON.stringify(value) }] },
    });
    const start = { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } };
    const replay = (records: unknown[]) => parseCodexSessionContent([start, ...records].map(record => JSON.stringify(record)).join('\n'));

    it.each(['array before native images', 'object after native images'])('removes a fully redundant script result: %s', shape => {
      const images = [generated('alpha'), generated('beta')];
      const records = shape.startsWith('array')
        ? [script, output([hint('beta'), hint('alpha')]), ...images]
        : [script, ...images, output({ a: hint('alpha'), b: hint('beta') })];
      const messages = replay(records);
      expect(messages.flatMap(message => message.toolCalls ?? []).map(tool => tool.id)).toEqual(['alpha', 'beta']);
      expect(messages.flatMap(message => message.contentBlocks ?? [])).not.toContainEqual({ type: 'tool_use', toolId: 'script' });
    });

    it.each(['array', 'object'])('keeps mixed %s output when generated hints are removed', shape => {
      const independent = { p1: 'Inspect /tmp/alpha.png', p2: { important: true } };
      const value = shape === 'array' ? [independent.p1, hint('alpha'), independent.p2] : { image: hint('alpha'), ...independent };
      const tools = replay([script, generated('alpha'), output(value)])
        .flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'script')).toMatchObject({
        name: 'exec', result: JSON.stringify(shape === 'array' ? Object.values(independent) : independent),
        presentation: { name: 'Script output', countsAsActivity: false },
      });
      expect(tools.find(tool => tool.id === 'alpha')?.resultImages).toHaveLength(1);
    });

    it.each(['failed script', 'failed image', 'different turn', 'additional text'])('preserves output without a verified duplicate: %s', scenario => {
      const records = [script, generated('alpha', scenario === 'failed image' ? 'failed' : 'completed')];
      if (scenario === 'different turn') records.reverse();
      const value = [scenario === 'additional text' ? `${hint('alpha')}\nIndependent notes` : hint('alpha')];
      const boundary = { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-2' } };
      const messages = replay([
        ...(scenario === 'different turn' ? [records[0], boundary, records[1]] : records),
        output(value, scenario === 'failed script' ? 'Script failed' : 'Script completed'),
      ]);
      const wrapped = messages.flatMap(message => message.toolCalls ?? []).find(tool => tool.id === 'script');
      expect(wrapped).toMatchObject({ result: JSON.stringify(value) });
      expect(wrapped?.status).toBe(scenario === 'failed script' ? 'error' : 'completed');
      expect(wrapped?.presentation).toBeUndefined();
    });

    it('keeps script output intact when parsing would change independent values', () => {
      const text = `{"image":${JSON.stringify(hint('alpha'))},"value":9007199254740993}`;
      const record = output(null);
      record.payload.output[1].text = text;
      const tools = replay([script, generated('alpha'), record]).flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'script')?.result).toBe(text);
    });
  });

  describe('image view envelope deduplication', () => {
    const generated = (id: string, imagePath: string, data: string) => ({
      type: 'event_msg', payload: { type: 'item_completed', item: {
        type: 'Extension', kind: 'image_gen.generation', id, status: 'completed',
        savedPath: imagePath, result: `data:image/png;base64,${data}`,
      } },
    });
    const viewed = (id: string, imagePath: string) => ({
      type: 'event_msg', payload: { type: 'item_completed', item: { type: 'ImageView', id, path: imagePath } },
    });
    const script = {
      type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'views',
        input: 'const a = await tools.view_image({path:"/tmp/a.png"}); image(a.image_url); const b = await tools.view_image({path:"/tmp/b.png"}); image(b.image_url);' },
    };
    const output = (text = '', images = ['Yg==', 'YQ=='], header = 'Script completed') => ({
      type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'views', output: [
        { type: 'input_text', text: `${header}\nOutput:\n${text}` },
        ...images.map(data => ({ type: 'input_image', image_url: `data:image/png;base64,${data}` })),
      ] },
    });
    const replay = (records: unknown[]) => parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'));
    const originals = () => [generated('generated-a', '/tmp/a.png', 'YQ=='), generated('generated-b', '/tmp/b.png', 'Yg==')];

    it.each(['before', 'between', 'after'])('deduplicates reversed aggregate images when output arrives %s native views', order => {
      const messages = replay([
        ...originals(), script,
        ...(order === 'before' ? [output()] : []), viewed('view-b', 'file:///tmp/b.png'),
        ...(order === 'between' ? [output()] : []), viewed('view-a', '/tmp/a.png'),
        ...(order === 'after' ? [output()] : []),
      ]);
      const tools = messages.flatMap(message => message.toolCalls ?? []);
      expect(tools.filter(tool => tool.name === 'Read')).toEqual([
        expect.objectContaining({ id: 'views:1', resultImages: [{ kind: 'data', data: 'YQ==', mediaType: 'image/png' }] }),
        expect.objectContaining({ id: 'views:2', resultImages: [{ kind: 'data', data: 'Yg==', mediaType: 'image/png' }] }),
      ]);
      expect(tools.some(tool => tool.id === 'views')).toBe(false);
      expect(tools.reduce((total, tool) => total + (tool.resultImages?.length ?? 0), 0)).toBe(4);
      expect(messages.flatMap(message => message.contentBlocks ?? [])).not.toContainEqual({ type: 'tool_use', toolId: 'views' });
    });

    it('keeps script text and unrelated image output while removing only proven duplicates', () => {
      const tools = replay([
        ...originals(), script, viewed('view-a', '/tmp/a.png'), viewed('view-b', '/tmp/b.png'),
        output('Inspection notes', ['Yg==', 'ZXh0cmE=', 'YQ==']),
      ]).flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'views')).toMatchObject({
        result: 'Inspection notes', resultImages: [{ kind: 'data', data: 'ZXh0cmE=', mediaType: 'image/png' }],
      });
    });

    it('keeps script text after all aggregate images have been deduplicated', () => {
      const tools = replay([
        ...originals(), script, viewed('view-a', '/tmp/a.png'), viewed('view-b', '/tmp/b.png'), output('Inspection notes'),
      ]).flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'views')).toMatchObject({ result: 'Inspection notes' });
      expect(tools.find(tool => tool.id === 'views')?.resultImages).toBeUndefined();
    });

    it('retains additional emissions beyond the number of verified child previews', () => {
      const tools = replay([
        ...originals(), script, viewed('view-a', '/tmp/a.png'), viewed('view-b', '/tmp/b.png'),
        output('', ['YQ==', 'Yg==', 'YQ==']),
      ]).flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'views')?.resultImages)
        .toEqual([{ kind: 'data', data: 'YQ==', mediaType: 'image/png' }]);
    });

    it('preserves a mixed-tool script even when its image views have matching native content', () => {
      const tools = replay([
        ...originals(), { ...script, payload: { ...script.payload, input: `${script.payload.input} text(await tools.exec_command({cmd:"pwd"}));` } },
        viewed('view-a', '/tmp/a.png'), viewed('view-b', '/tmp/b.png'), output(),
      ]).flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'views')?.resultImages).toHaveLength(2);
      expect(tools.find(tool => tool.name === 'Bash')).toBeDefined();
    });

    it('preserves a failed script and its image output', () => {
      const tools = replay([
        ...originals(), script, viewed('view-a', '/tmp/a.png'), viewed('view-b', '/tmp/b.png'),
        output('Script error: inspection failed', ['Yg==', 'YQ=='], 'Script failed'),
      ]).flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'views')).toMatchObject({ status: 'error', result: expect.stringContaining('inspection failed') });
      expect(tools.find(tool => tool.id === 'views')?.resultImages).toHaveLength(2);
    });

    it('preserves unclaimed output when one native view is missing', () => {
      const tools = replay([...originals(), script, viewed('view-a', '/tmp/a.png'), output()])
        .flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'views')?.resultImages)
        .toEqual([{ kind: 'data', data: 'Yg==', mediaType: 'image/png' }]);
      expect(tools.find(tool => tool.id === 'views:2')?.resultImages).toBeUndefined();
    });

    it('keeps aggregate data when native paths cannot establish image content', () => {
      const tools = replay([script, viewed('view-a', '/tmp/a.png'), viewed('view-b', '/tmp/b.png'), output()])
        .flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'views')?.resultImages).toHaveLength(2);
      expect(tools.find(tool => tool.id === 'views:1')?.resultImages).toEqual([{ kind: 'file', path: '/tmp/a.png' }]);
    });

    it('does not choose among different generated contents for the same path', () => {
      const tools = replay([
        ...originals(), generated('replaced-a', '/tmp/a.png', 'b3RoZXI='), script,
        viewed('view-a', '/tmp/a.png'), viewed('view-b', '/tmp/b.png'), output(),
      ]).flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'views')?.resultImages)
        .toEqual([{ kind: 'data', data: 'YQ==', mediaType: 'image/png' }]);
    });

    it('preserves images and status while the enclosing script is still running', () => {
      const tools = replay([
        ...originals(), script, viewed('view-a', '/tmp/a.png'), viewed('view-b', '/tmp/b.png'),
        output('', ['Yg==', 'YQ=='], 'Script running with cell ID 42'),
      ]).flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'views')).toMatchObject({ status: 'running', resultImages: expect.any(Array) });
      expect(tools.find(tool => tool.id === 'views')?.resultImages).toHaveLength(2);
    });
  });

  it('does not restore Codex internal context calls or their private output', () => {
    const content = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'get_context_remaining',
          call_id: 'private-context',
          arguments: '{}',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'private-context',
          output: '{"tokens_left":100}',
        },
      }),
    ].join('\n');

    expect(parseCodexSessionContent(content)).toEqual([]);
  });

  it('does not restore private output from an exec wrapper around a context tool', () => {
    const content = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'private-script',
          input: 'text(await tools.get_context_remaining({}));',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'private-script',
          output: 'Script completed\nOutput:\n{"tokens_left":100}',
        },
      }),
    ].join('\n');

    expect(JSON.stringify(parseCodexSessionContent(content))).not.toMatch(/get_context_remaining|tokens_left/);
  });

  it('does not restore yielded internal output or its wait continuation', () => {
    const content = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'private-yield',
          input: 'text(await tools.get_context_remaining({}));',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'private-yield',
          output: 'Script running with cell ID 42\nWall time 0.1 seconds\nOutput:\n',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', name: 'wait', call_id: 'private-wait', arguments: '{"cell_id":"42"}' },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'private-wait',
          output: 'Script completed\nWall time 0.1 seconds\nOutput:\n{"tokens_left":100}',
        },
      }),
    ].join('\n');

    expect(parseCodexSessionContent(content)).toEqual([]);
  });

  it('does not attach aggregate private output to visible calls in a mixed exec wrapper', () => {
    const content = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'mixed-script',
          input: 'text(await tools.get_context_remaining({})); text(await tools.exec_command({cmd:"pwd"}));',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'mixed-script',
          output: 'Script completed\nOutput:\n{"tokens_left":100}\n/workspace',
        },
      }),
    ].join('\n');

    const messages = parseCodexSessionContent(content);
    const rendered = JSON.stringify(messages);
    expect(rendered).not.toMatch(/get_context_remaining|tokens_left/);
    expect(rendered).toContain('"name":"Bash"');
    expect(rendered).toContain('"command":"pwd"');
    expect(rendered).not.toContain('/workspace');
  });

  it('hides a yielded mixed-script continuation in history', () => {
    const content = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'mixed-yield',
          input: 'text(await tools.get_context_remaining({})); text(await tools.exec_command({cmd:"pwd"}));',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'mixed-yield',
          output: 'Script running with cell ID 42\nWall time 0.1 seconds\nOutput:\n',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', name: 'wait', call_id: 'mixed-wait', arguments: '{"cell_id":"42"}' },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'mixed-wait',
          output: 'Script completed\nWall time 0.1 seconds\nOutput:\n{"tokens_left":100}\n/workspace',
        },
      }),
    ].join('\n');

    const rendered = JSON.stringify(parseCodexSessionContent(content));
    expect(rendered).not.toMatch(/get_context_remaining|tokens_left|mixed-wait/);
    expect(rendered).toContain('"name":"Bash"');
  });

  it('withholds mixed-script values whose array positions cannot establish ownership', () => {
    const content = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'split-script',
          input: 'text(await tools.get_context_remaining({})); text(await tools.exec_command({cmd:"pwd"}));',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'split-script',
          output: [
            { type: 'text', text: 'Script completed\nOutput:\n' },
            { type: 'text', text: '{"tokens_left":100}' },
            { type: 'text', text: '/workspace' },
          ],
        },
      }),
    ].join('\n');

    const rendered = JSON.stringify(parseCodexSessionContent(content));
    expect(rendered).not.toMatch(/get_context_remaining|tokens_left/);
    expect(rendered).not.toContain('/workspace');
  });

  it('reads the selected model from a transcript without loading the whole file', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-history-model-'));
    const filePath = path.join(directory, 'session.jsonl');
    await fs.writeFile(filePath, [
      JSON.stringify({ type: 'turn_context', payload: { turn_id: 'before', model: 'model-before' } }),
      JSON.stringify({ type: 'turn_context', payload: { turn_id: 'selected', model: 'model-selected' } }),
      JSON.stringify({ type: 'turn_context', payload: { turn_id: 'after', model: 'model-after' } }),
    ].join('\n'));

    try {
      await expect(readCodexSessionModel(filePath)).resolves.toBe('model-after');
      await expect(readCodexSessionModel(filePath, 'selected')).resolves.toBe('model-selected');
      await expect(readCodexSessionModel(filePath, 'missing')).resolves.toBeNull();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('settles lookup at the deadline when a directory read never resolves', async () => {
    jest.useFakeTimers();
    try {
      const root = '/virtual/codex/sessions';
      const pathExists = jest.fn(async (value: string) => value === root);
      const readDirectory = jest.fn(() => new Promise<never>(() => {}));
      const lookup = findCodexSessionFileAsync('thread', root, 10, {
        pathExists,
        readDirectory,
      });

      for (let index = 0; index < 10 && !readDirectory.mock.calls.length; index += 1) {
        await Promise.resolve();
      }
      expect(pathExists).toHaveBeenCalled();
      expect(readDirectory).toHaveBeenCalled();
      jest.advanceTimersByTime(11);

      await expect(lookup).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  describe('path helpers', () => {
    it('derives transcript and memories roots from POSIX session paths', () => {
      const sessionFilePath = '/home/user/.codex/sessions/2026/04/14/rollout-thread.jsonl';

      expect(deriveCodexSessionsRootFromSessionPath(sessionFilePath)).toBe('/home/user/.codex/sessions');
      expect(deriveCodexMemoriesDirFromSessionsRoot('/home/user/.codex/sessions')).toBe(
        '/home/user/.codex/memories',
      );
    });

    it('derives transcript and memories roots from WSL UNC session paths', () => {
      const sessionFilePath = '\\\\wsl$\\Ubuntu\\home\\user\\.codex\\sessions\\2026\\04\\14\\rollout-thread.jsonl';

      expect(deriveCodexSessionsRootFromSessionPath(sessionFilePath)).toBe(
        '\\\\wsl$\\Ubuntu\\home\\user\\.codex\\sessions',
      );
      expect(deriveCodexMemoriesDirFromSessionsRoot('\\\\wsl$\\Ubuntu\\home\\user\\.codex\\sessions')).toBe(
        '\\\\wsl$\\Ubuntu\\home\\user\\.codex\\memories',
      );
    });
  });

  describe('parseCodexSessionFile - simple session', () => {
    it('should parse a simple session with reasoning and agent message', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-simple.jsonl');
      const messages = parseCodexSessionFile(filePath);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].content).toBe('Hello! I can help you with that.');

      // Should have thinking content block
      const thinkingBlock = messages[0].contentBlocks?.find(b => b.type === 'thinking');
      expect(thinkingBlock).toBeDefined();
      expect(thinkingBlock).toMatchObject({
        type: 'thinking',
        content: 'Let me think about this request carefully.',
      });

      // Should have text content block
      const textBlock = messages[0].contentBlocks?.find(b => b.type === 'text');
      expect(textBlock).toBeDefined();
    });

    it('should rebuild thinking text from persisted reasoning content blocks', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-29T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Explain this.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-29T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'reasoning',
            summary: [],
            content: ['First thought', ' second thought'],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-29T00:00:00.002Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages[1].contentBlocks).toEqual([
        { type: 'thinking', content: 'First thought\n\nsecond thought' },
        { type: 'text', content: 'Done.' },
      ]);
    });

    it('preserves interleaved reasoning, tools, and assistant text in transcript order', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-07-13T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'agent_reasoning', text: 'Inspecting the note.' },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:01.001Z',
          type: 'response_item',
          payload: {
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: 'Inspecting the note.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            name: 'exec',
            call_id: 'call_read',
            input: 'const r = await tools.exec_command({cmd:"sed -n \'1,20p\' DEMO.md"}); text(r.output);',
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call_read',
            output: 'Script completed\nOutput:\nDemo content',
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:04.000Z',
          type: 'event_msg',
          payload: { type: 'agent_reasoning', text: 'Verifying the edit.' },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:04.001Z',
          type: 'response_item',
          payload: {
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: 'Verifying the edit.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:05.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            name: 'exec',
            call_id: 'call_verify',
            input: 'const r = await tools.exec_command({cmd:"tail -n 2 DEMO.md"}); text(r.output);',
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:06.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call_verify',
            output: 'Script completed\nOutput:\nEdited',
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:07.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'Done.' },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:07.001Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const assistantMessage = messages.find(message => message.role === 'assistant');

      expect(assistantMessage?.contentBlocks).toEqual([
        { type: 'thinking', content: 'Inspecting the note.' },
        { type: 'tool_use', toolId: 'call_read' },
        { type: 'thinking', content: 'Verifying the edit.' },
        { type: 'tool_use', toolId: 'call_verify' },
        { type: 'text', content: 'Done.' },
      ]);
    });

    it('replays memory citations without exposing raw markup or duplicating assistant text', () => {
      const citationMarkup = [
        '<oai-mem-citation>',
        '<citation_entries>',
        'MEMORY.md:10-12|note=[Used project conventions]',
        '</citation_entries>',
        '<rollout_ids>',
        'thread-1',
        '</rollout_ids>',
        '</oai-mem-citation>',
      ].join('\n');
      const content = [
        JSON.stringify({
          timestamp: '2026-07-29T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-07-29T00:00:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'agent_message',
            message: 'Answer',
            memory_citation: {
              entries: [{
                path: 'MEMORY.md',
                lineStart: 10,
                lineEnd: 12,
                note: 'Used project conventions',
              }],
              rolloutIds: ['thread-1'],
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-29T00:00:01.001Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: `Answer\n${citationMarkup}` }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-29T00:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const assistantMessage = messages.find(message => message.role === 'assistant');

      expect(assistantMessage?.content).toBe('Answer');
      expect(assistantMessage?.content).not.toContain('oai-mem-citation');
      expect(assistantMessage?.contentBlocks).toEqual([
        { type: 'text', content: 'Answer' },
        {
          type: 'citations',
          citations: {
            kind: 'memory',
            entries: [{
              path: 'MEMORY.md',
              lineStart: 10,
              lineEnd: 12,
              note: 'Used project conventions',
            }],
          },
        },
      ]);
    });

    describe('completed AgentMessage memory citations', () => {
      const entries = [
        { path: 'MEMORY.md', lineStart: 10, lineEnd: 12, note: 'Project conventions' },
        { path: 'rollout_summaries/check.md', lineStart: 3, lineEnd: 5, note: 'Prior results' },
      ];
      const citation = { entries };
      const completed = (id: string, memoryCitation: unknown = citation) => ({ type: 'event_msg', payload: {
        type: 'item_completed', item: { type: 'AgentMessage', id, memory_citation: memoryCitation },
      } });
      const response = (id: string, text: string) => ({ type: 'response_item', payload: {
        type: 'message', role: 'assistant', id, content: [{ type: 'output_text', text }],
      } });
      const legacy = { type: 'event_msg', payload: { type: 'agent_message', message: 'Answer', memory_citation: citation } };
      const answer = response('msg-answer', 'Answer\n<oai-mem-citation>ignored wire markup</oai-mem-citation>');
      const citationBlock = { type: 'citations', citations: { kind: 'memory', entries } };
      const replay = (records: unknown[]) => parseCodexSessionContent([
        { type: 'event_msg', payload: { type: 'task_started', turn_id: 'citation-turn' } },
        ...records,
      ].map(record => JSON.stringify(record)).join('\n'));

      it.each(['before', 'after'])('restores structured sources when completion arrives %s the reply', order => {
        const completion = completed('msg-answer');
        const [message] = replay(order === 'before' ? [completion, answer] : [answer, completion]);
        expect(message.content).toBe('Answer');
        expect(message.contentBlocks).toEqual([{ type: 'text', content: 'Answer' }, citationBlock]);
      });

      it.each(['before', 'after'])('deduplicates equivalent legacy citations %s the paired reply', order => {
        const replies = order === 'before' ? [legacy, answer] : [answer, legacy];
        const [message] = replay([response('msg-commentary', 'Checking the records.'), completed('msg-answer'),
          ...replies, completed('msg-answer')]);
        expect(message.content).toBe('Checking the records.\n\nAnswer');
        expect(message.contentBlocks).toEqual([{ type: 'text', content: message.content }, citationBlock]);
      });

      it('does not attach source metadata to a different reply or restore invalid entries', () => {
        const [message] = replay([completed('unmatched'), completed('msg-answer', { entries: [{ path: 'MEMORY.md' }] }), answer]);
        expect(message.contentBlocks).toEqual([{ type: 'text', content: 'Answer' }]);
      });
    });

    it('rehydrates user images from persisted input_image parts', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-07-06T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: '<image name=[Image #1] path="/tmp/1-image-1.png">' },
              { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' },
              { type: 'input_text', text: '</image>' },
              { type: 'input_text', text: 'What is in this image?' },
            ],
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-06T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'It says hello.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages[0]).toMatchObject({
        content: 'What is in this image?',
        images: [{
          data: 'aGVsbG8=',
          id: 'codex-img-turn-1-0',
          mediaType: 'image/png',
          name: 'image-1.png',
          size: 5,
          source: 'paste',
        }],
        role: 'user',
      });
    });
  });

  describe('parseCodexSessionFile - tools session', () => {
    it('should parse a session with command execution and file changes', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-tools.jsonl');
      const messages = parseCodexSessionFile(filePath);

      expect(messages).toHaveLength(1);

      const msg = messages[0];
      expect(msg.toolCalls).toBeDefined();
      expect(msg.toolCalls!.length).toBeGreaterThanOrEqual(2);

      // Check command execution
      const bashTool = msg.toolCalls!.find(tc => tc.name === 'Bash');
      expect(bashTool).toBeDefined();
      expect(bashTool!.input.command).toBe('cat src/main.ts');
      expect(bashTool!.status).toBe('completed');

      // Check file change
      const patchTool = msg.toolCalls!.find(tc => tc.name === 'apply_patch');
      expect(patchTool).toBeDefined();
      expect(patchTool!.status).toBe('completed');
    });

    it('should preserve content blocks order', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-tools.jsonl');
      const messages = parseCodexSessionFile(filePath);

      const blocks = messages[0].contentBlocks;
      expect(blocks).toBeDefined();
      expect(blocks!.length).toBeGreaterThanOrEqual(3);

      // First block should be text (from initial agent message)
      expect(blocks![0].type).toBe('text');
      // Then tool_use blocks
      const toolBlocks = blocks!.filter(b => b.type === 'tool_use');
      expect(toolBlocks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('parseCodexSessionFile - abort session', () => {
    it('should handle turn.failed and mark as interrupted', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-abort.jsonl');
      const messages = parseCodexSessionFile(filePath);

      // Should have two messages: one interrupted, one successful
      expect(messages).toHaveLength(2);
      expect(messages[0].isInterrupt).toBe(true);
      expect(messages[1].isInterrupt).toBeUndefined();
      expect(messages[1].content).toBe('OK, what would you like me to do instead?');
    });

    it('keeps the latest streamed content for interrupted turns', () => {
      const content = [
        JSON.stringify({ type: 'event', event: { type: 'turn.started' } }),
        JSON.stringify({ type: 'event', event: { type: 'item.started', item: { id: 'item_1', type: 'agent_message', text: '' } } }),
        JSON.stringify({ type: 'event', event: { type: 'item.updated', item: { id: 'item_1', type: 'agent_message', text: 'Hello' } } }),
        JSON.stringify({ type: 'event', event: { type: 'item.updated', item: { id: 'item_1', type: 'agent_message', text: 'Hello world' } } }),
        JSON.stringify({ type: 'event', event: { type: 'turn.failed', error: { message: 'Cancelled' } } }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: 'assistant',
        content: 'Hello world',
        isInterrupt: true,
      });
    });
  });

  describe('parseCodexSessionFile - web search session', () => {
    it('should parse web search items', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-websearch.jsonl');
      const messages = parseCodexSessionFile(filePath);

      expect(messages).toHaveLength(1);

      const msg = messages[0];
      expect(msg.toolCalls).toBeDefined();

      const searchTool = msg.toolCalls!.find(tc => tc.name === 'WebSearch');
      expect(searchTool).toBeDefined();
      expect(searchTool!.input.query).toBe('obsidian plugin API documentation');
      expect(searchTool!.status).toBe('completed');
    });
  });

  describe('parseCodexSessionFile - non-existent file', () => {
    it('should return empty array for missing files', () => {
      const messages = parseCodexSessionFile('/nonexistent/path.jsonl');
      expect(messages).toEqual([]);
    });
  });

  describe('parseCodexSessionContent - persisted response items', () => {
    it('reconstructs user and assistant turns from response_item logs', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Review this diff.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'agent_reasoning',
            text: 'Thinking through the changes.',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'shell_command',
            arguments: '{"command":"git diff --stat"}',
            call_id: 'call_1',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_1',
            output: 'Exit code: 0\nOutput:\n src/main.ts | 2 +-',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:04.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'The diff looks good.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        role: 'user',
        content: 'Review this diff.',
      });
      expect(messages[1]).toMatchObject({
        role: 'assistant',
        content: 'The diff looks good.',
      });

      expect(messages[1].toolCalls).toEqual([
        expect.objectContaining({
          id: 'call_1',
          name: 'Bash',
          input: { command: 'git diff --stat' },
          status: 'completed',
        }),
      ]);

      // Result should be normalized (Output:\n stripped)
      expect(messages[1].toolCalls![0].result).toBe(' src/main.ts | 2 +-');

      expect(messages[1].contentBlocks).toEqual([
        { type: 'thinking', content: 'Thinking through the changes.' },
        { type: 'tool_use', toolId: 'call_1' },
        { type: 'text', content: 'The diff looks good.' },
      ]);
    });

    it('deduplicates the same user message when both response_item and event_msg are persisted', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'hi' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.001Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'hi',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'agent_message',
            message: 'Hello there.',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.001Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hello there.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toEqual([
        expect.objectContaining({
          role: 'user',
          content: 'hi',
        }),
        expect.objectContaining({
          role: 'assistant',
          content: 'Hello there.',
        }),
      ]);
    });
  });

  describe('parseCodexSessionFile - persisted tools', () => {
    it('restores exec_command as Bash with normalized result', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-persisted-tools.jsonl');
      const messages = parseCodexSessionFile(filePath);

      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      expect(assistantMsg).toBeDefined();

      const bashTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'Bash');
      expect(bashTool).toBeDefined();
      expect(bashTool!.id).toBe('call_exec_1');
      expect(bashTool!.input).toEqual({ command: 'cat src/main.ts' });
      expect(bashTool!.status).toBe('completed');
      // Result should be normalized: "Output:\n" prefix stripped
      expect(bashTool!.result).toBe("import { Plugin } from 'obsidian';");
    });

    it('restores custom_tool_call apply_patch as native apply_patch', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-persisted-tools.jsonl');
      const messages = parseCodexSessionFile(filePath);

      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      const patchTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'apply_patch');
      expect(patchTool).toBeDefined();
      expect(patchTool!.id).toBe('call_patch_1');
      expect(patchTool!.input.patch).toContain('Update File: src/main.ts');
      expect(patchTool!.status).toBe('completed');
    });

    it.each([false, true])('keeps reordered script output separate from commands (private values: %s)', privateValues => {
      const input = `${privateValues ? 'text(await tools.get_context_remaining({})); ' : ''}`
        + 'const first = await tools.exec_command({cmd:"first"}); const second = await tools.exec_command({cmd:"second"}); '
        + 'text(second.output); text(first.output);';
      const records = [
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'batch', input } },
        { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'batch', output: [
          { type: 'input_text', text: 'Script completed\nOutput:\n' },
          { type: 'input_text', text: 'SECOND\n' },
          { type: 'input_text', text: privateValues ? '{"tokens_left":100}' : 'FIRST\n' },
          ...(privateValues ? [{ type: 'input_text', text: 'FIRST\n' }] : []),
        ] } },
      ];
      const messages = parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'));
      const tools = messages.flatMap(message => message.toolCalls ?? []);
      expect(tools.filter(tool => tool.name === 'Bash').map(tool => tool.result)).toEqual([undefined, undefined]);
      expect(tools.map(tool => [tool.name, tool.result])).toEqual(privateValues
        ? [['Bash', undefined], ['Bash', undefined]]
        : [['Bash', undefined], ['Bash', undefined], ['exec', 'SECOND\nFIRST\n']]);
      expect(JSON.stringify(messages)).not.toMatch(/get_context_remaining|tokens_left/);
    });

    it.each([0, 1, -1])('restores native exit code %s and duration when a single command prints only output', exitCode => {
      for (const shape of ['direct', 'script']) {
        for (const order of ['before', 'after']) {
          const native = { type: 'event_msg', payload: { type: 'item_completed', item: {
            type: 'CommandExecution', id: 'native-command', command: ['/bin/zsh', '-lc', 'check'],
            cwd: 'file:///vault', aggregated_output: 'native output', exit_code: exitCode,
            duration: { secs: 1, nanos: 485_852_000 },
          } } };
          const records = [
            { type: 'turn_context', payload: { cwd: '/vault' } },
            { type: 'response_item', payload: shape === 'direct'
              ? { type: 'function_call', name: 'exec_command', call_id: 'command', arguments: '{"cmd":"check"}' }
              : { type: 'custom_tool_call', name: 'exec', call_id: 'command',
                input: 'const result = await tools.exec_command({cmd:"check"}); text(result.output);' } },
            ...(order === 'before' ? [native] : []),
            { type: 'response_item', payload: { type: shape === 'direct' ? 'function_call_output' : 'custom_tool_call_output',
              call_id: 'command', output: 'Script completed\nOutput:\nprinted output' } },
            ...(order === 'after' ? [native] : []),
          ];
          const tools = parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'))
            .flatMap(message => message.toolCalls ?? []);
          expect({ shape, order, tools }).toEqual({ shape, order, tools: [expect.objectContaining({
            id: 'command', name: 'Bash', exitCode, durationMs: expect.closeTo(1485.852, 6),
            status: exitCode === 0 ? 'completed' : 'error', result: 'native output',
          })] });
        }
      }
    });

    it.each([undefined, null, { secs: -1, nanos: 0 }, { secs: 0, nanos: 1_000_000_000 }])(
      'leaves timing unset for an absent or invalid native duration: %j', duration => {
        const records = [
          { type: 'turn_context', payload: { cwd: '/vault' } },
          { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'command',
            arguments: '{"cmd":"check"}' } },
          { type: 'event_msg', payload: { type: 'item_completed', item: {
            type: 'CommandExecution', id: 'native', command: 'check', cwd: '/vault',
            aggregated_output: 'done', exit_code: 0, duration,
          } } },
        ];
        const [tool] = parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'))
          .flatMap(message => message.toolCalls ?? []);
        expect(tool).toMatchObject({ exitCode: 0, result: 'done' });
        expect(tool).not.toHaveProperty('durationMs');
      },
    );

    it.each(['before', 'after'])('uses unambiguous native command evidence %s reordered script output', position => {
      const native = { type: 'event_msg', payload: { type: 'item_completed', item: {
        type: 'CommandExecution', id: 'native-second', command: ['/bin/zsh', '-lc', 'second'],
        cwd: '/vault', aggregated_output: 'Native second failure', exit_code: 7,
      } } };
      const records = [
        { type: 'turn_context', payload: { cwd: '/vault' } },
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'batch',
          input: 'text(await tools.exec_command({cmd:"first"})); text(await tools.exec_command({cmd:"second"}));' } },
        ...(position === 'before' ? [native] : []),
        { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'batch', output: [
          { type: 'input_text', text: 'Script completed\nOutput:\n' },
          { type: 'input_text', text: 'SECOND\n' },
          { type: 'input_text', text: 'FIRST\n' },
        ] } },
        ...(position === 'after' ? [native] : []),
      ];
      const tools = parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'))
        .flatMap(message => message.toolCalls ?? []);
      expect(tools.map(tool => [tool.id, tool.status, tool.result])).toEqual([
        ['batch:1', 'completed', undefined],
        ['batch:2', 'error', 'Native second failure'],
        ['batch', 'completed', 'SECOND\nFIRST\n'],
      ]);
    });

    it.each([
      ['read and search', [
        { type: 'search', query: 'match.*value', path: 'notes/' },
        { type: 'read', path: 'notes/a.md' },
        { type: 'read', path: 'notes/b.md' },
      ], 0, { reads: 2, searches: 1, actions: [
        { type: 'search', query: 'match.*value', path: 'notes/' },
        { type: 'read', path: 'notes/a.md' },
        { type: 'read', path: 'notes/b.md' },
      ] }],
      ['missing details', [{ type: 'search', query: null }, { type: 'read', path: 10 }], 0, { reads: 1, searches: 1 }],
      ['unknown action', [{ type: 'read', path: 'a.md' }, { type: 'unknown' }], 0, undefined],
      ['no actions', [], 0, undefined],
      ['failed command', [{ type: 'read', path: 'a.md' }], 7, undefined],
    ] as const)('projects exploration only for successful native commands: %s', (_case, actions, exitCode, expected) => {
      const cmd = 'rg match && cat a.md b.md';
      const records = [
        { type: 'turn_context', payload: { cwd: '/vault' } },
        { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'command',
          arguments: JSON.stringify({ cmd }) } },
        { type: 'event_msg', payload: { type: 'item_completed', item: {
          type: 'CommandExecution', id: 'native', cwd: '/vault', command: ['/bin/zsh', '-lc', cmd],
          parsed_cmd: actions, exit_code: exitCode, aggregated_output: 'Native output',
        } } },
      ];
      const [tool] = parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'))
        .flatMap(message => message.toolCalls ?? []);
      expect(tool.exploration).toEqual(expected);
      expect(tool).toMatchObject({ name: 'Bash', input: { command: cmd }, exitCode, result: 'Native output' });
    });

    it('does not let script output replace an authoritative native exit code', () => {
      const records = [
        { type: 'turn_context', payload: { cwd: '/vault' } },
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'command',
          input: 'text(await tools.exec_command({cmd:"check"}));' } },
        { type: 'event_msg', payload: { type: 'item_completed', item: {
          type: 'CommandExecution', id: 'native', command: 'check', cwd: '/vault', aggregated_output: 'failed', exit_code: 1,
        } } },
        { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'command',
          output: 'Script completed\nOutput:\n{"exit_code":0,"output":"success"}' } },
      ];
      expect(parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'))
        .flatMap(message => message.toolCalls ?? [])).toEqual([expect.objectContaining({
        id: 'command', exitCode: 1, status: 'error', result: 'failed',
      })]);
    });

    it.each([
      [0, '', []],
      [1, '', [expect.objectContaining({ id: 'empty', exitCode: 1 })]],
      [0, 'Native output', [expect.objectContaining({ id: 'empty', result: 'Native output' })]],
    ] as const)('projects an empty native command with exit %s and output %j', (exitCode, result, expected) => {
      const records = [
        { type: 'turn_context', payload: { cwd: '/vault' } },
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'empty',
          input: 'text(await tools.exec_command({cmd:""}));' } },
        { type: 'event_msg', payload: { type: 'item_completed', item: {
          type: 'CommandExecution', id: 'empty-native', command: ['/bin/zsh', '-lc', ''],
          cwd: '/vault', aggregated_output: result, exit_code: exitCode,
        } } },
        { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'empty',
          output: 'Script completed\nOutput:\n' } },
      ];
      expect(parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'))
        .flatMap(message => message.toolCalls ?? [])).toEqual(expected);
    });

    it.each(['Script completed', 'Script error:\nSyntaxError: invalid token'])(
      'ends opaque ownership uncertainty after terminal script output: %s', output => {
        const records = [
          { type: 'turn_context', payload: { cwd: '/vault' } },
          { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'opaque',
            input: 'await runUnknownScript();' } },
          { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'opaque', output } },
          { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'next',
            input: 'text(await tools.exec_command({cmd:"check"}));' } },
          { type: 'event_msg', payload: { type: 'item_completed', item: {
            type: 'CommandExecution', id: 'next-native', command: 'check', cwd: '/vault', aggregated_output: '', exit_code: 1,
          } } },
        ];
        const tools = parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'))
          .flatMap(message => message.toolCalls ?? []);
        expect(tools.find(tool => tool.id === 'next')).toMatchObject({ exitCode: 1, status: 'error' });
      },
    );

    it.each(['Script running with cell ID 42', 'Script completed\nOutput:\nProcess running with session ID 123'])(
      'retains opaque ownership uncertainty for yielded work: %s', output => {
        const records = [
          { type: 'turn_context', payload: { cwd: '/vault' } },
          { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'opaque',
            input: 'await runUnknownScript();' } },
          { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'opaque', output } },
          { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'next',
            input: 'text(await tools.exec_command({cmd:"check"}));' } },
          { type: 'event_msg', payload: { type: 'item_completed', item: {
            type: 'CommandExecution', id: 'native', command: 'check', cwd: '/vault', aggregated_output: '', exit_code: 1,
          } } },
        ];
        const tools = parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'))
          .flatMap(message => message.toolCalls ?? []);
        expect(tools.find(tool => tool.id === 'next')?.exitCode).toBeUndefined();
      },
    );

    it.each(['direct', 'single script', 'opaque script'])('does not guess native ownership with a competing %s', competitor => {
      const call = competitor === 'direct'
        ? { type: 'function_call', name: 'exec_command', call_id: 'other', arguments: '{"cmd":"same"}' }
        : { type: 'custom_tool_call', name: 'exec', call_id: 'other', input: competitor === 'opaque script'
          ? 'const cmd = "same"; text(await tools.exec_command({cmd}));'
          : 'text(await tools.exec_command({cmd:"same"}));' };
      const records = [
        { type: 'turn_context', payload: { cwd: '/vault' } },
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'batch',
          input: 'text(await tools.exec_command({cmd:"same"})); text(await tools.exec_command({cmd:"different"}));' } },
        { type: 'response_item', payload: call },
        { type: 'event_msg', payload: { type: 'item_completed', item: {
          type: 'CommandExecution', id: 'ambiguous', command: ['/bin/zsh', '-lc', 'same'],
          cwd: '/vault', aggregated_output: 'Unidentified output', exit_code: 7,
        } } },
      ];
      const tools = parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'))
        .flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'batch:1')?.result).toBeUndefined();
    });

    it('keeps opaque scripts ambiguous until a new turn starts', () => {
      const batch = (id: string) => ({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: id,
        input: 'text(await tools.exec_command({cmd:"same"})); text(await tools.exec_command({cmd:"other"}));' } });
      const native = (id: string) => ({ type: 'event_msg', payload: { type: 'item_completed', item: {
        type: 'CommandExecution', id, command: 'same', cwd: '/vault', aggregated_output: 'Native result', exit_code: 0,
      } } });
      const records = [
        { type: 'turn_context', payload: { cwd: '/vault' } },
        { type: 'event_msg', payload: { type: 'task_started' } },
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'opaque', input: 'await runUnknownScript();' } },
        batch('ambiguous'), native('unknown'),
        { type: 'event_msg', payload: { type: 'task_complete' } },
        { type: 'event_msg', payload: { type: 'task_started' } },
        batch('known'), native('identified'),
      ];
      const tools = parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'))
        .flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'ambiguous:1')?.result).toBeUndefined();
      expect(tools.find(tool => tool.id === 'known:1')).toMatchObject({ result: 'Native result', status: 'completed' });
    });

    it('keeps previously claimed commands as evidence against ambiguous repeated execution', () => {
      const native = (id: string, output: string) => ({ type: 'event_msg', payload: { type: 'item_completed', item: {
        type: 'CommandExecution', id, command: 'same', cwd: '/vault', aggregated_output: output, exit_code: 0,
      } } });
      const records = [
        { type: 'turn_context', payload: { cwd: '/vault' } },
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'loop',
          input: 'for (let i = 0; i < 2; i++) { text(await tools.exec_command({cmd:"same"})); } text(await tools.exec_command({cmd:"other"}));' } },
        native('first', 'First result'),
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'next',
          input: 'text(await tools.exec_command({cmd:"same"})); text(await tools.exec_command({cmd:"different"}));' } },
        native('second', 'Unidentified second result'),
      ];
      const tools = parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'))
        .flatMap(message => message.toolCalls ?? []);
      expect(tools.find(tool => tool.id === 'loop:1')?.result).toBe('First result');
      expect(tools.find(tool => tool.id === 'next:1')?.result).toBeUndefined();
    });

    it('restores completed exec envelopes as their nested tools', () => {
      const patch = '*** Begin Patch\n*** Update File: note.md\n*** End Patch';
      const content = [
        JSON.stringify({
          timestamp: '2026-07-10T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-07-10T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            name: 'exec',
            call_id: 'call_exec_wrapper',
            input: 'const r = await tools.exec_command({cmd:"ls -1",workdir:"/vault"}); text(r.output);',
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-10T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call_exec_wrapper',
            output: [
              { type: 'input_text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' },
              { type: 'input_text', text: 'file.txt\n' },
            ],
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-10T00:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            name: 'exec',
            call_id: 'call_patch_wrapper',
            input: `const patch = ${JSON.stringify(patch)};\ntext(await tools.apply_patch(patch));`,
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-10T00:00:04.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call_patch_wrapper',
            output: [{ type: 'input_text', text: 'Script completed\nOutput:\nApplied patch' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const toolCalls = messages.flatMap(message => message.toolCalls ?? []);

      expect(toolCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'call_exec_wrapper',
          name: 'Bash',
          input: { command: 'ls -1' },
          status: 'completed',
          result: 'file.txt\n',
        }),
        expect.objectContaining({
          id: 'call_patch_wrapper',
          name: 'apply_patch',
          input: { patch },
          status: 'completed',
        }),
      ]));
    });

    it.each(['custom_tool_call', 'function_call'])('preserves failed %s exec scripts without inventing nested executions', (callType) => {
      const script = 'text(await tools.apply_patch("invalid patch")); text(await tools.exec_command({cmd:"never runs"}));';
      const error = 'Script error:\napply_patch verification failed: missing expected lines';
      const content = [
        { type: 'event_msg', payload: { type: 'task_started', turn_id: 'failed-script-turn' } },
        { type: 'response_item', payload: { type: callType, name: 'exec', call_id: 'failed-script', input: script } },
        { type: 'response_item', payload: { type: `${callType}_output`, call_id: 'failed-script', output: [
          { type: 'input_text', text: 'Script failed\nWall time 0.0 seconds\nOutput:\n' },
          { type: 'input_text', text: error },
        ] } },
        { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'failed-script-turn' } },
      ].map((record, seconds) => JSON.stringify({ timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(), ...record })).join('\n');

      const messages = parseCodexSessionContent(content);
      expect(messages.flatMap(message => message.toolCalls ?? [])).toEqual([
        expect.objectContaining({ id: 'failed-script', name: 'exec', input: { raw: script }, status: 'error', result: expect.stringContaining(error) }),
      ]);
      expect(messages.flatMap(message => message.contentBlocks ?? [])).toEqual([
        { type: 'tool_use', toolId: 'failed-script' },
      ]);
    });

    it.each([
      [0, 'completed'],
      [1, 'error'],
      [-1, 'error'],
    ])('restores structured command exit code %s through direct and exec outputs', (exitCode, status) => {
      const result = JSON.stringify({ output: 'command output', exit_code: exitCode, wall_time_seconds: 1 });
      const content = [
        { type: 'event_msg', payload: { type: 'task_started' } },
        { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'direct', arguments: '{"cmd":"check"}' } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'direct', output: result } },
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'wrapped', input: 'text(await tools.exec_command({cmd:"check"}));' } },
        { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'wrapped', output: [
          { type: 'input_text', text: 'Script completed\nWall time 1.0 seconds\nOutput:\n' },
          { type: 'input_text', text: result },
        ] } },
        { type: 'event_msg', payload: { type: 'task_complete' } },
      ].map((record, seconds) => JSON.stringify({ timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(), ...record })).join('\n');

      expect(parseCodexSessionContent(content).flatMap(message => message.toolCalls ?? [])).toEqual([
        expect.objectContaining({ id: 'direct', status, result: 'command output', exitCode }),
        expect.objectContaining({ id: 'wrapped', status, result: 'command output', exitCode }),
      ]);
    });

    it.each(['direct', 'wrapped'])('retains a failed unowned %s poll under its own identity', shape => {
      const records = [
        { type: 'response_item', payload: shape === 'direct'
          ? { type: 'function_call', name: 'write_stdin', call_id: 'poll', arguments: '{"session_id":42,"chars":""}' }
          : { type: 'custom_tool_call', name: 'exec', call_id: 'poll', input: 'text(await tools.write_stdin({session_id:42,chars:""}));' } },
        { type: 'response_item', payload: {
          type: shape === 'direct' ? 'function_call_output' : 'custom_tool_call_output',
          call_id: 'poll', output: `${shape === 'wrapped' ? 'Script completed\nOutput:\n' : ''}`
            + JSON.stringify({ output: 'late failure', exit_code: 2 }),
        } },
      ];
      const messages = parseCodexSessionContent(records.map(record => JSON.stringify(record)).join('\n'));
      expect(messages.flatMap(message => message.toolCalls ?? [])).toEqual([
        expect.objectContaining({ id: 'poll', name: 'write_stdin', result: 'late failure', status: 'error' }),
      ]);
      expect(messages.flatMap(message => message.contentBlocks ?? [])).toEqual([
        { type: 'tool_use', toolId: 'poll' },
      ]);
    });

    it('retains an unowned polling wrapper through a yielded script cell', () => {
      const records = [
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'poll',
          input: 'text(await tools.write_stdin({session_id:42,chars:""}));' } },
        { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'poll',
          output: 'Script running with cell ID poll-cell\nOutput:\n' } },
        { type: 'response_item', payload: { type: 'function_call', name: 'wait', call_id: 'wait-poll', arguments: '{"cell_id":"poll-cell"}' } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'wait-poll',
          output: 'Script completed\nOutput:\n' + JSON.stringify({ output: 'late failure', exit_code: 2 }) } },
      ];
      const serialize = (count: number) => records.slice(0, count).map(record => JSON.stringify(record)).join('\n');
      expect(parseCodexSessionContent(serialize(2)).flatMap(message => message.toolCalls ?? [])).toEqual([
        expect.objectContaining({ id: 'poll', name: 'write_stdin', status: 'running' }),
      ]);
      expect(parseCodexSessionContent(serialize(4)).flatMap(message => message.toolCalls ?? [])).toEqual([
        expect.objectContaining({ id: 'poll', name: 'write_stdin', status: 'error', result: 'late failure' }),
      ]);
    });

    it('keeps delayed unowned polling failures in their original turn', () => {
      const records = [
        { type: 'event_msg', payload: { type: 'task_started', turn_id: 'first' } },
        { type: 'response_item', payload: { type: 'function_call', name: 'write_stdin', call_id: 'poll', arguments: '{"session_id":42,"chars":""}' } },
        { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'first' } },
        { type: 'event_msg', payload: { type: 'task_started', turn_id: 'second' } },
        { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Second answer' }] } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'poll', output: JSON.stringify({ output: 'late failure', exit_code: 1 }) } },
      ];
      const turns = parseCodexSessionTurns(records.map(record => JSON.stringify(record)).join('\n'));
      expect(turns[0].messages.flatMap(message => message.toolCalls ?? [])).toEqual([
        expect.objectContaining({ id: 'poll', result: 'late failure', status: 'error' }),
      ]);
      expect(turns[1].messages.flatMap(message => message.toolCalls ?? [])).toEqual([]);
    });

    it('joins structured terminal polling output to its running command and restores its failure', () => {
      const records = [
        { type: 'event_msg', payload: { type: 'task_started' } },
        { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'command', arguments: '{"cmd":"long check"}' } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'command', output: JSON.stringify({ output: 'started', exit_code: null, session_id: 42 }) } },
        { type: 'response_item', payload: { type: 'function_call', name: 'write_stdin', call_id: 'poll', arguments: '{"session_id":42,"chars":""}' } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'poll', output: JSON.stringify({ output: 'failed', exit_code: 2 }) } },
        { type: 'event_msg', payload: { type: 'task_complete' } },
      ];
      const serialize = (entries: typeof records) => entries.map((record, seconds) => JSON.stringify({ timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(), ...record })).join('\n');

      expect(parseCodexSessionContent(serialize(records.slice(0, 3))).flatMap(message => message.toolCalls ?? [])).toEqual([
        expect.objectContaining({ id: 'command', status: 'running', result: 'started' }),
      ]);
      expect(parseCodexSessionContent(serialize(records)).flatMap(message => message.toolCalls ?? [])).toEqual([
        expect.objectContaining({ id: 'command', status: 'error', result: 'started\nfailed' }),
      ]);
    });

    it('preserves settled command and polling values on their scripts without inferring owners', () => {
      const records = [
        { type: 'event_msg', payload: { type: 'task_started' } },
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'batch', input: 'const results = await Promise.allSettled([tools.exec_command({cmd:"first"}), tools.exec_command({cmd:"second"})]); for (const result of results) text(result);' } },
        { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'batch', output: [
          { type: 'input_text', text: 'Script completed\nOutput:\n' },
          { type: 'input_text', text: JSON.stringify({ status: 'fulfilled', value: { output: 'first failed', exit_code: 1 } }) },
          { type: 'input_text', text: JSON.stringify({ status: 'fulfilled', value: { output: 'second started', session_id: 42 } }) },
        ] } },
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'poll-batch', input: 'text(await tools.write_stdin({session_id:42,chars:""})); text(await tools.exec_command({cmd:"third"}));' } },
        { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'poll-batch', output: [
          { type: 'input_text', text: 'Script completed\nOutput:\n' },
          { type: 'input_text', text: JSON.stringify({ output: 'second failed', exit_code: 2 }) },
          { type: 'input_text', text: JSON.stringify({ output: 'third passed', exit_code: 0 }) },
        ] } },
        { type: 'event_msg', payload: { type: 'task_complete' } },
      ];
      const content = records.map((record, seconds) => JSON.stringify({ timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(), ...record })).join('\n');
      const messages = parseCodexSessionContent(content);
      expect(messages.flatMap(message => message.toolCalls ?? []).map(tool => [tool.id, tool.name, tool.result])).toEqual([
        ['batch:1', 'Bash', undefined],
        ['batch:2', 'Bash', undefined],
        ['batch', 'exec', '{"status":"fulfilled","value":{"output":"first failed","exit_code":1}}'
          + '{"status":"fulfilled","value":{"output":"second started","session_id":42}}'],
        ['poll-batch:2', 'Bash', undefined],
        ['poll-batch', 'exec', '{"output":"second failed","exit_code":2}{"output":"third passed","exit_code":0}'],
      ]);
      expect(messages.flatMap(message => message.contentBlocks ?? [])).toEqual([
        { type: 'tool_use', toolId: 'batch:1' },
        { type: 'tool_use', toolId: 'batch:2' },
        { type: 'tool_use', toolId: 'batch' },
        { type: 'tool_use', toolId: 'poll-batch:2' },
        { type: 'tool_use', toolId: 'poll-batch' },
      ]);
    });

    it('restores every command while preserving uncorrelated output on its script', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-07-13T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            name: 'exec',
            call_id: 'call_exec_group',
            input: [
              'const first = await tools.exec_command({cmd:"pwd",workdir:"/vault"});',
              'text(first.output);',
              'const second = await tools.exec_command({cmd:"printf edit",workdir:"/vault"});',
              'text(second.output);',
              'const third = await tools.exec_command({cmd:"wc -l note.md",workdir:"/vault"});',
              'text(third.output);',
            ].join('\n'),
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call_exec_group',
            output: [
              { type: 'input_text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' },
              { type: 'input_text', text: '/vault\n' },
              { type: 'input_text', text: '' },
              { type: 'input_text', text: '80 note.md\n' },
            ],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const assistantMessage = messages.find(message => message.role === 'assistant');

      expect(assistantMessage?.toolCalls).toEqual([
        expect.objectContaining({
          id: 'call_exec_group:1',
          name: 'Bash',
          input: { command: 'pwd' },
          status: 'completed',
        }),
        expect.objectContaining({
          id: 'call_exec_group:2',
          name: 'Bash',
          input: { command: 'printf edit' },
          status: 'completed',
        }),
        expect.objectContaining({
          id: 'call_exec_group:3',
          name: 'Bash',
          input: { command: 'wc -l note.md' },
          status: 'completed',
        }),
        expect.objectContaining({ id: 'call_exec_group', name: 'exec', result: '/vault\n80 note.md\n', status: 'completed' }),
      ]);
      expect(assistantMessage?.contentBlocks).toEqual([
        { type: 'tool_use', toolId: 'call_exec_group:1' },
        { type: 'tool_use', toolId: 'call_exec_group:2' },
        { type: 'tool_use', toolId: 'call_exec_group:3' },
        { type: 'tool_use', toolId: 'call_exec_group' },
      ]);
    });

    it('preserves script images without guessing which image view emitted them', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-07-13T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            name: 'exec',
            call_id: 'call_image_group',
            input: [
              'const first = await tools.view_image({path:"/tmp/first.png",detail:"original"});',
              'image(first.image_url);',
              'const second = await tools.view_image({path:"/tmp/second.png",detail:"original"});',
              'image(second.image_url);',
            ].join('\n'),
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-13T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call_image_group',
            output: [
              { type: 'input_text', text: 'Script completed\nWall time 0.0 seconds\nOutput:\n' },
              { type: 'input_image', image_url: 'data:image/png;base64,Zmlyc3Q=' },
              { type: 'input_image', image_url: 'data:image/png;base64,c2Vjb25k' },
            ],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const assistantMessage = messages.find(message => message.role === 'assistant');

      expect(assistantMessage?.toolCalls).toEqual([
        expect.objectContaining({
          id: 'call_image_group:1',
          name: 'Read',
          input: expect.objectContaining({ file_path: '/tmp/first.png' }),
          status: 'completed',
        }),
        expect.objectContaining({
          id: 'call_image_group:2',
          name: 'Read',
          input: expect.objectContaining({ file_path: '/tmp/second.png' }),
          status: 'completed',
        }),
        expect.objectContaining({
          id: 'call_image_group', name: 'exec', status: 'completed',
          resultImages: [
            { kind: 'data', data: 'Zmlyc3Q=', mediaType: 'image/png' },
            { kind: 'data', data: 'c2Vjb25k', mediaType: 'image/png' },
          ],
        }),
      ]);
    });

    it('restores yielded exec envelopes as one completed Bash tool', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-07-10T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-07-10T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            name: 'exec',
            call_id: 'call_exec_wrapper',
            input: 'const r = await tools.exec_command({cmd:"npm test"}); text(r.output);',
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-10T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call_exec_wrapper',
            output: [
              { type: 'input_text', text: 'Script running with cell ID 42\nWall time 10.0 seconds\nOutput:\n' },
              { type: 'input_text', text: 'tests started\n' },
            ],
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-10T00:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'wait',
            call_id: 'call_wait_1',
            arguments: '{"cell_id":"42","yield_time_ms":30000}',
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-10T00:00:04.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_wait_1',
            output: [
              { type: 'input_text', text: 'Script running with cell ID 42\nWall time 30.0 seconds\nOutput:\n' },
              { type: 'input_text', text: 'tests still running\n' },
            ],
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-10T00:00:05.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'wait',
            call_id: 'call_wait_2',
            arguments: '{"cell_id":"42","yield_time_ms":30000}',
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-10T00:00:06.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_wait_2',
            output: [
              { type: 'input_text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' },
              { type: 'input_text', text: 'tests passed\n' },
            ],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const toolCalls = messages.flatMap(message => message.toolCalls ?? []);

      expect(toolCalls).toEqual([expect.objectContaining({
        id: 'call_exec_wrapper',
        name: 'Bash',
        input: { command: 'npm test' },
        status: 'completed',
        result: 'tests started\ntests still running\ntests passed\n',
      })]);
    });

    it('restores raw custom_tool_call apply_patch input as patch text', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            name: 'apply_patch',
            call_id: 'call_patch_raw',
            input: '*** Begin Patch\n*** Update File: src/main.ts\n*** End Patch',
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      const patchTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'apply_patch');
      expect(patchTool).toBeDefined();
      expect(patchTool!.input.patch).toBe('*** Begin Patch\n*** Update File: src/main.ts\n*** End Patch');
    });

    it('restores update_plan as TodoWrite', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-persisted-tools.jsonl');
      const messages = parseCodexSessionFile(filePath);

      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      const todoTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'TodoWrite');
      expect(todoTool).toBeDefined();
      expect(todoTool!.id).toBe('call_plan_1');
      expect(todoTool!.input.todos).toEqual([
        expect.objectContaining({ content: 'Fix the bug', status: 'completed' }),
        expect.objectContaining({ content: 'Run tests', status: 'in_progress' }),
      ]);
    });

    it('restores request_user_input as AskUserQuestion', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-persisted-tools.jsonl');
      const messages = parseCodexSessionFile(filePath);

      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      const askTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'AskUserQuestion');
      expect(askTool).toBeDefined();
      expect(askTool!.id).toBe('call_ask_1');
      expect(askTool!.input.questions).toEqual([
        expect.objectContaining({ question: 'Should I also update the tests?', id: 'q1' }),
      ]);
    });

    it('restores async question notifications and applies hidden user replies to the original tool', () => {
      const tool = {
        id: 'async-question',
        name: 'AskUserQuestion',
        status: 'completed' as const,
        input: {
          replyMode: 'user-message',
          questions: [{ id: '0', question: 'Which check?', header: 'Check', options: [], multiSelect: false }],
        },
      };
      const reply = formatCodexQuestionReply(tool, { '0': 'History' })!;
      const content = [
        JSON.stringify({ timestamp: '2026-03-27T00:00:00.000Z', type: 'event_msg', payload: { type: 'task_started' } }),
        JSON.stringify({ timestamp: '2026-03-27T00:00:01.000Z', type: 'event_msg', payload: {
          type: 'item_completed', item: { type: 'agentMessage', id: 'async-question', delivery: 'async', questions: [{ title: 'Which check?', options: [] }] },
        } }),
        JSON.stringify({ timestamp: '2026-03-27T00:00:02.000Z', type: 'event_msg', payload: { type: 'user_message', message: reply.content } }),
        JSON.stringify({ timestamp: '2026-03-27T00:00:03.000Z', type: 'event_msg', payload: { type: 'agent_message', message: 'I will check history.' } }),
        JSON.stringify({ timestamp: '2026-03-27T00:00:04.000Z', type: 'event_msg', payload: { type: 'task_complete' } }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const question = messages.flatMap(message => message.toolCalls ?? []).find(call => call.id === 'async-question');
      expect(question).toMatchObject({
        name: 'AskUserQuestion',
        status: 'completed',
        input: { replyMode: 'user-message' },
        resolvedAnswers: { '0': 'History' },
      });
      expect(messages.filter(message => message.role === 'user').every(message => message.displayContent === '')).toBe(true);
      expect(messages.filter(message => message.role === 'user')
        .every(message => message.isProviderContinuation === true)).toBe(true);
    });

    it('restores request_user_input options and multi-select metadata', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'request_user_input',
            call_id: 'call_ask_opts',
            arguments: JSON.stringify({
              questions: [{
                id: 'title_generation_timing',
                question: 'When should I generate the title?',
                options: [
                  { label: 'Non-blocking', description: 'Generate it later.' },
                  { label: 'Blocking', description: 'Wait before continuing.' },
                ],
                multi_select: true,
              }],
            }),
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      const askTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'AskUserQuestion');

      expect(askTool!.input.questions).toEqual([
        {
          id: 'title_generation_timing',
          question: 'When should I generate the title?',
          header: 'Q1',
          options: [
            { label: 'Non-blocking', description: 'Generate it later.' },
            { label: 'Blocking', description: 'Wait before continuing.' },
          ],
          multiSelect: true,
        },
      ]);
    });

    it('restores view_image as Read', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-persisted-tools.jsonl');
      const messages = parseCodexSessionFile(filePath);

      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      const readTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'Read');
      expect(readTool).toBeDefined();
      expect(readTool!.id).toBe('call_img_1');
      expect(readTool!.input.file_path).toBe('/tmp/screenshot.png');
    });

    it('restores non-empty write_stdin as native write_stdin', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-persisted-tools.jsonl');
      const messages = parseCodexSessionFile(filePath);

      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      const stdinTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'write_stdin');
      expect(stdinTool).toBeDefined();
      expect(stdinTool!.id).toBe('call_stdin_1');
      expect(stdinTool!.input.session_id).toBe('sess_1');
      expect(stdinTool!.input.chars).toBe('y\n');
    });

    it('suppresses standalone empty write_stdin polling calls', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'write_stdin',
            arguments: '{"session_id":2404,"chars":"","yield_time_ms":1000}',
            call_id: 'call_poll',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_poll',
            output: 'Input sent.',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const assistantMsg = messages.find(m => m.role === 'assistant');

      expect(assistantMsg!.toolCalls).toBeUndefined();
    });

    it('maps long-running write_stdin polling output back to the parent Bash tool', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Run checks.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            arguments: '{"cmd":"bun run check"}',
            call_id: 'call_cmd',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_cmd',
            output: 'Chunk ID: aaa\nWall time: 0.0000 seconds\nProcess running with session ID 2404\nOriginal token count: 3\nOutput:\n$ bun run check\n',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'write_stdin',
            arguments: '{"session_id":2404,"chars":"","yield_time_ms":1000}',
            call_id: 'call_poll',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:04.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_poll',
            output: 'Chunk ID: bbb\nWall time: 1.0000 seconds\nProcess exited with code 0\nOriginal token count: 2\nOutput:\nall good\n',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:05.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);

      expect(assistantMsg!.toolCalls!.map(tc => tc.name)).not.toContain('write_stdin');
      const bashTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'Bash');
      expect(bashTool).toMatchObject({
        id: 'call_cmd',
        status: 'completed',
        result: '$ bun run check\nall good\n',
      });
    });

    it('keeps non-empty write_stdin separate from the parent Bash tool', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Confirm the prompt.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            arguments: '{"cmd":"npm init"}',
            call_id: 'call_cmd',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_cmd',
            output: 'Chunk ID: aaa\nWall time: 0.0000 seconds\nProcess running with session ID 2404\nOriginal token count: 2\nOutput:\nProceed? [y/N]\n',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'write_stdin',
            arguments: '{"session_id":2404,"chars":"y\\n"}',
            call_id: 'call_stdin',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:04.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_stdin',
            output: 'Input sent.',
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      const bashTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'Bash');
      const stdinTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'write_stdin');

      expect(bashTool).toMatchObject({
        id: 'call_cmd',
        status: 'running',
        result: 'Proceed? [y/N]\n',
      });
      expect(stdinTool).toMatchObject({
        id: 'call_stdin',
        status: 'completed',
        input: { session_id: 2404, chars: 'y\n' },
        result: 'Input sent.',
      });
    });

    it('drops orphan custom_tool_call_output rows instead of rendering generic tool cards', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call_patch_orphan',
            output: 'Success. Updated the following files:\nM /tmp/a.ts\n',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].toolCalls).toBeUndefined();
      expect(messages[0].content).toBe('Done.');
    });
  });

  describe('parseCodexSessionFile - agent lifecycle', () => {
    it('restores agent lifecycle tools with native names', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-agent-lifecycle.jsonl');
      const messages = parseCodexSessionFile(filePath);

      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      expect(assistantMsg).toBeDefined();
      const toolNames = assistantMsg!.toolCalls!.map(tc => tc.name);

      expect(toolNames).toContain('spawn_agent');
      expect(toolNames).toContain('send_input');
      expect(toolNames).toContain('wait');
      expect(toolNames).toContain('resume_agent');
      expect(toolNames).toContain('close_agent');

      // Should NOT be mapped to Agent/Task
      expect(toolNames).not.toContain('Agent');
      expect(toolNames).not.toContain('Task');
    });

    it('preserves spawn_agent input fields', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-agent-lifecycle.jsonl');
      const messages = parseCodexSessionFile(filePath);

      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      const spawnTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'spawn_agent');
      expect(spawnTool!.input).toEqual({
        message: 'Update the imports in utils.ts',
        agent_type: 'code-writer',
      });
    });

    it('preserves wait input fields', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-agent-lifecycle.jsonl');
      const messages = parseCodexSessionFile(filePath);

      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      const waitTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'wait');
      expect(waitTool!.input).toEqual({
        ids: ['agent_001'],
        timeout_ms: 30000,
      });
    });
  });

  describe('parseCodexSessionContent - system-injected user messages', () => {
    it('should skip AGENTS.md instructions injected as user message', () => {
      const content = [
        JSON.stringify({ type: 'session_meta', id: 'test-session' }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'developer',
            content: [{ type: 'input_text', text: '<permissions instructions>\nSandbox mode...\n</permissions instructions>' }],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: '# AGENTS.md instructions for /Users/test/project\n\n<INSTRUCTIONS>\nDo good work.\n</INSTRUCTIONS>' },
              { type: 'input_text', text: '<environment_context>\n  <cwd>/Users/test/project</cwd>\n</environment_context>' },
            ],
          },
        }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Fix the bug in main.ts' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      // AGENTS.md message should be filtered out; only real user + assistant remain
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ role: 'user', content: 'Fix the bug in main.ts' });
      expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Done.' });
    });

    it('should skip standalone <environment_context> user message', () => {
      const content = [
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/Users/test</cwd>\n</environment_context>' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Ready.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ role: 'assistant', content: 'Ready.' });
    });

    it('should skip recommended plugin metadata before AGENTS.md instructions', () => {
      const metadataText = [
        '<recommended_plugins>',
        'Install Google Drive when it would help.',
        '</recommended_plugins>',
        '# AGENTS.md instructions for /Users/test/project',
        '',
        '<INSTRUCTIONS>',
        'Do good work.',
        '</INSTRUCTIONS>',
        '<environment_context>',
        '  <cwd>/Users/test/project</cwd>',
        '</environment_context>',
      ].join('\n');
      const content = [
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: metadataText }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-10T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Ready.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ role: 'assistant', content: 'Ready.' });
    });

    it('should skip Conductor interrupt control envelope persisted as user message', () => {
      const conductorControlText = [
        '<system_instruction>',
        'You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.',
        '</system_instruction>',
        '',
        '<turn_aborted>',
        'The user interrupted the previous turn on purpose.',
        '</turn_aborted>',
        '',
        '<user-preferences>',
        'dev notes and throwaway scripts should be placed inside .context/',
        '</user-preferences>',
      ].join('\n');

      const content = [
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: conductorControlText }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Fix the interrupt rendering bug.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Fixed.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ role: 'user', content: 'Fix the interrupt rendering bug.' });
      expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Fixed.' });
    });

    it('should strip leading Conductor control blocks and keep visible user text', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{
              type: 'input_text',
              text: [
                '<system_instruction>',
                'You are working inside Conductor.',
                '</system_instruction>',
                '',
                '<turn_aborted>',
                'The user interrupted the previous turn on purpose.',
                '</turn_aborted>',
                '',
                'Hide the interrupt envelope, but keep this prompt.',
              ].join('\n'),
            }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        role: 'user',
        content: 'Hide the interrupt envelope, but keep this prompt.',
      });
      expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Done.' });
    });

    it('should set displayContent stripping bracket context from user messages', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Fix the bug\n[Current note: notes/bug.md]' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        role: 'user',
        content: 'Fix the bug\n[Current note: notes/bug.md]',
        displayContent: 'Fix the bug',
      });
    });

    it('should set displayContent stripping editor selection context', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Explain this\n[Editor selection from notes/code.md:\nconst x = 1;\n]' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'It declares a variable.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages[0]).toMatchObject({
        role: 'user',
        displayContent: 'Explain this',
      });
    });

    it('should not set displayContent on plain user messages', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'What does main.ts do?' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'It initializes the plugin.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages[0]).toMatchObject({ role: 'user', content: 'What does main.ts do?' });
      expect(messages[0].displayContent).toBeUndefined();
    });

    it('should filter out skill wrapper user messages as system-injected', () => {
      const skillText = [
        '<skill>',
        '<name>test</name>',
        '<path>/Users/me/.codex/skills/test/SKILL.md</path>',
        '---',
        'description: testing',
        '---',
        '',
        '## Task',
        '',
        'tell me a joke',
        '',
        '</skill>',
      ].join('\n');

      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: skillText }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Why did the skeleton...' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      // Skill wrapper is system-injected — only the assistant message should remain
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ role: 'assistant' });
    });

    it('should NOT skip real user messages', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'What does main.ts do?' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'It initializes the plugin.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ role: 'user', content: 'What does main.ts do?' });
    });
  });

  describe('parseCodexSessionFile - persisted web_search_call', () => {
    it('restores web_search_call as WebSearch', () => {
      const filePath = path.join(FIXTURES_DIR, 'codex-session-websearch-persisted.jsonl');
      const messages = parseCodexSessionFile(filePath);

      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      expect(assistantMsg).toBeDefined();

      const searchTool = assistantMsg!.toolCalls!.find(tc => tc.name === 'WebSearch');
      expect(searchTool).toBeDefined();
      expect(searchTool!.id).toBe('call_ws_1');
      expect(searchTool!.input.actionType).toBe('search');
      expect(searchTool!.input.query).toBe('obsidian plugin API');
      expect(searchTool!.status).toBe('completed');
    });

  it('keeps distinct persisted web_search_call entries when call_id is missing', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'web_search_call',
            status: 'completed',
            action: { type: 'search', query: 'obsidian plugin API' },
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'web_search_call',
            status: 'completed',
            action: { type: 'open_page', url: 'https://docs.obsidian.md' },
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls);
      expect(assistantMsg).toBeDefined();

      const webSearchTools = assistantMsg!.toolCalls!.filter(tc => tc.name === 'WebSearch');
      expect(webSearchTools).toHaveLength(2);
      expect(webSearchTools[0]).toMatchObject({
        id: 'tail-ws-1',
        input: { actionType: 'search', query: 'obsidian plugin API' },
        result: 'Search complete',
      });
      expect(webSearchTools[1]).toMatchObject({
        id: 'tail-ws-2',
        input: { actionType: 'open_page', url: 'https://docs.obsidian.md' },
        result: 'Search complete',
      });
    });

    it('restores native web search result links from an extension item', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            name: 'exec',
          call_id: 'search-call-a',
          input: 'text(await tools.web__run({search_query:[{q:"Claudian docs"}]}));',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-27T00:00:00.500Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'search-call-b',
          input: 'text(await tools.web__run({search_query:[{q:"Codex docs"},{q:"Codex API"}]}));',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'item_completed',
            item: {
              type: 'Extension',
              kind: 'web.search',
              id: 'native-search',
              query: 'Codex docs ...',
              action: { type: 'search', queries: ['Codex docs', 'Codex API'] },
              results: [{ type: 'text_result', title: 'Codex guide', url: 'https://example.com/docs', snippet: 'private excerpt' }],
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'search-call-a',
            output: 'Search complete',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.500Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'search-call-b',
            output: 'Search complete',
          },
        }),
      ].join('\n');

      const tools = parseCodexSessionContent(content)
        .flatMap(message => message.toolCalls ?? [])
        .filter(call => call.name === 'WebSearch');
      expect(tools.find(call => call.input.query === 'Codex docs')?.result)
        .toBe('Links: [{"title":"Codex guide","url":"https://example.com/docs"}]');
      expect(tools.find(call => call.input.query === 'Claudian docs')?.result).toBe('Search complete');
    });
  });

  describe('parseCodexSessionContent - event_msg handling', () => {
    it('task_started + agent_message + task_complete produces proper turn', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Hello' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'Hi there!' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:03.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ role: 'user', content: 'Hello' });
      expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Hi there!' });
    });

    it('does not restore unfinished tools as running after a turn is interrupted', () => {
      const content = [
        { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
        { type: 'response_item', payload: { type: 'function_call', name: 'sleep', call_id: 'sleep-1', arguments: '{}' } },
        { type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', call_id: 'question-1', arguments: '{}' } },
        { type: 'event_msg', payload: { type: 'turn_aborted' } },
      ].map(record => JSON.stringify(record)).join('\n');
      const messages = parseCodexSessionContent(content);
      const tools = messages.flatMap(message => message.toolCalls ?? []);
      expect(tools).toHaveLength(2);
      expect(tools.map(tool => tool.status)).toEqual(['cancelled', 'cancelled']);
      expect(messages.some(message => message.isInterrupt)).toBe(true);
    });

    it('restores an exec envelope aborted by the user as interrupted', () => {
      const content = [
        { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'cmd-1', input: 'const r = await tools.exec_command({cmd:"sleep 60",yield_time_ms:30000}); text(JSON.stringify(r));' } },
        { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'cmd-1', output: 'aborted by user after 4.0s' } },
        { type: 'event_msg', payload: { type: 'turn_aborted', reason: 'interrupted' } },
      ].map(record => JSON.stringify(record)).join('\n');
      const tool = parseCodexSessionContent(content).flatMap(message => message.toolCalls ?? []).find(item => item.id === 'cmd-1');
      expect(tool).toMatchObject({ status: 'cancelled', result: 'aborted by user after 4.0s' });
    });

    it('retains native yielded terminal sessions across an interrupted turn', () => {
      const content = [
        { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
        { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'cmd-1', arguments: '{"cmd":"sleep 100"}' } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'cmd-1', output: 'Process running with session ID 42\nOutput:\n' } },
        { type: 'event_msg', payload: { type: 'turn_aborted' } },
      ].map(record => JSON.stringify(record)).join('\n');
      const tool = parseCodexSessionContent(content).flatMap(message => message.toolCalls ?? []).find(item => item.id === 'cmd-1');
      expect(tool).toMatchObject({ status: 'running' });
    });

    it('accepts a later native tool completion after an interruption', () => {
      const content = [
        { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
        { type: 'response_item', payload: { type: 'function_call', name: 'sleep', call_id: 'sleep-late', arguments: '{}' } },
        { type: 'event_msg', payload: { type: 'turn_aborted' } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'sleep-late', output: 'completed' } },
      ].map(record => JSON.stringify(record)).join('\n');
      const tool = parseCodexSessionContent(content).flatMap(message => message.toolCalls ?? []).find(item => item.id === 'sleep-late');
      expect(tool).toMatchObject({ status: 'completed', result: 'completed' });
    });

    it('turn_aborted marks bubble as interrupted', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'Working on it...' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'turn_aborted' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: 'assistant',
        content: 'Working on it...',
        isInterrupt: true,
      });
    });

    it('user_message reconstructs user ChatMessage from event_msg', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.500Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'What is 2+2?' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'The answer is 4.' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        role: 'user',
        content: 'What is 2+2?',
      });
      expect(messages[1]).toMatchObject({
        role: 'assistant',
        content: 'The answer is 4.',
      });
    });

    it('keeps leading indented image markup as a literal code example', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.500Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: '    <image></image>\n\nExplain the code.' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages[0]).toMatchObject({
        role: 'user',
        content: '    <image></image>\n\nExplain the code.',
      });
    });

    it('user_message with system content is filtered out', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.500Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: '# AGENTS.md instructions for /test\nDo good.' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'Done.' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      // System user message should be filtered; only assistant remains
      const userMessages = messages.filter(m => m.role === 'user');
      expect(userMessages).toHaveLength(0);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ role: 'assistant', content: 'Done.' });
    });
  });

  describe('parseCodexSessionContent - multi-bubble turns', () => {
    it('assistant text + tool call + tool result + more text in single turn', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Check the file.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'agent_reasoning', text: 'Let me check.' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            arguments: '{"command":"cat file.txt"}',
            call_id: 'call_100',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_100',
            output: 'Exit code: 0\nOutput:\nhello world',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:04.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'The file contains hello world.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ role: 'user', content: 'Check the file.' });

      const assistant = messages[1];
      expect(assistant.role).toBe('assistant');
      expect(assistant.content).toBe('The file contains hello world.');

      // Tool calls should be present
      expect(assistant.toolCalls).toHaveLength(1);
      expect(assistant.toolCalls![0]).toMatchObject({
        id: 'call_100',
        name: 'Bash',
        status: 'completed',
      });

      // Content blocks: thinking, tool_use, text
      expect(assistant.contentBlocks).toBeDefined();
      const blockTypes = assistant.contentBlocks!.map(b => b.type);
      expect(blockTypes).toContain('thinking');
      expect(blockTypes).toContain('tool_use');
      expect(blockTypes).toContain('text');
    });
  });

  describe('parseCodexSessionContent - cross-turn tool output', () => {
    it('function_call in turn 1, function_call_output in turn 2 links back', () => {
      const content = [
        // Turn 1: user + tool call
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Run the command.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            arguments: '{"command":"echo hi"}',
            call_id: 'call_cross_1',
          },
        }),
        // Turn 2: new user message + output for turn 1's call
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Continue.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_cross_1',
            output: 'Exit code: 0\nOutput:\nhi',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:04.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      // Find the assistant message from turn 1 (has the tool call)
      const turn1Assistant = messages.find(
        m => m.role === 'assistant' && m.toolCalls?.some(tc => tc.id === 'call_cross_1'),
      );
      expect(turn1Assistant).toBeDefined();

      // The tool output should be resolved back to turn 1
      const tc = turn1Assistant!.toolCalls!.find(t => t.id === 'call_cross_1');
      expect(tc!.status).toBe('completed');
      expect(tc!.result).toBe('hi');
    });
  });

  describe('parseCodexSessionContent - non-string tool output', () => {
    it('does not crash when function_call_output has an array output (e.g. view_image)', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'turn-img' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Show me the image.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'view_image',
            arguments: '{"path":"/tmp/cat.png"}',
            call_id: 'call_img_1',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_img_1',
            output: [{ type: 'input_image', image_url: 'data:image/jpeg;base64,abc' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:04.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Here is the image.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:05.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      // Should not throw and should produce messages
      expect(messages.length).toBeGreaterThan(0);

      // The tool call should be resolved
      const assistantMsg = messages.find(
        m => m.role === 'assistant' && m.toolCalls?.some(tc => tc.id === 'call_img_1'),
      );
      expect(assistantMsg).toBeDefined();

      const tc = assistantMsg!.toolCalls!.find(t => t.id === 'call_img_1');
      expect(tc!.status).toBe('completed');
      expect(tc!.result).toBe('/tmp/cat.png');
    });
  });

  describe('parseCodexSessionContent - interrupted message granularity', () => {
    it('interrupted bubble with content sets isInterrupt on ChatMessage', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'Starting to work on the feature...' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'turn_aborted' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Starting to work on the feature...');
      expect(messages[0].isInterrupt).toBe(true);
    });

    it('interrupted empty bubble sets isInterrupt on bare ChatMessage', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'turn_aborted' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('');
      expect(messages[0].isInterrupt).toBe(true);
    });
  });

  describe('parseCodexSessionContent - response duration', () => {
    const nativeTurn = (duration: unknown) => [
      { timestamp: '2026-03-27T00:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'timed-turn' } },
      { timestamp: '2026-03-27T00:00:02.000Z', type: 'response_item', payload: {
        type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Do the work.' }],
      } },
      { timestamp: '2026-03-27T00:03:12.000Z', type: 'event_msg', payload: { type: 'agent_message', message: 'Done.' } },
      { timestamp: '2026-03-27T00:03:12.165Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'timed-turn', duration_ms: duration } },
    ];
    const jsonl = (records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n');

    it('prefers the complete native turn duration and preserves millisecond precision', () => {
      const messages = parseCodexSessionContent(jsonl(nativeTurn(192_165)));
      expect(messages.find(message => message.role === 'assistant')?.durationSeconds).toBe(192.165);
    });

    it.each([[0, 0], [180_500, 180.5]] as const)('keeps valid native duration %s even when the timestamp estimate is longer', (duration, expected) => {
      expect(parseCodexSessionContent(jsonl(nativeTurn(duration))).at(-1)?.durationSeconds).toBe(expected);
    });

    it.each([undefined, null, -1, '192165'])('falls back to timestamps when native duration is unavailable or invalid: %s', duration => {
      expect(parseCodexSessionContent(jsonl(nativeTurn(duration))).at(-1)?.durationSeconds).toBe(190);
    });

    it('rejects a non-finite native duration decoded from JSON', () => {
      const content = jsonl(nativeTurn(0)).replace('"duration_ms":0', '"duration_ms":1e309');
      expect(parseCodexSessionContent(content).at(-1)?.durationSeconds).toBe(190);
    });

    it('restores native duration even when transcript timestamps are missing', () => {
      const records = nativeTurn(192_165).map(record => ({ ...record, timestamp: undefined }));
      expect(parseCodexSessionContent(jsonl(records)).at(-1)?.durationSeconds).toBe(192.165);
    });

    it('does not carry a measured duration into the next turn', () => {
      const later = nativeTurn(undefined).map(record => ({
        ...record, timestamp: new Date(Date.parse(record.timestamp) + 300_000).toISOString(),
        payload: { ...record.payload, turn_id: 'later-turn' },
      }));
      const messages = parseCodexSessionContent(jsonl([...nativeTurn(192_165), ...later]));
      expect(messages.filter(message => message.role === 'assistant').map(message => message.durationSeconds)).toEqual([192.165, 190]);
    });

    it('retains the timestamp fallback for interrupted turns without native completion', () => {
      const records = [...nativeTurn(undefined).slice(0, -1), {
        timestamp: '2026-03-27T00:03:12.165Z', type: 'event_msg', payload: { type: 'turn_aborted' },
      }];
      expect(parseCodexSessionContent(jsonl(records)).at(-1)).toMatchObject({ isInterrupt: true, durationSeconds: 190 });
    });

    it('attaches the native duration only to the final bubble across compaction', () => {
      const records = nativeTurn(192_165);
      const messages = parseCodexSessionContent(jsonl([
        ...records.slice(0, -1),
        { timestamp: '2026-03-27T00:03:12.001Z', type: 'event_msg', payload: { type: 'context_compacted' } },
        { timestamp: '2026-03-27T00:03:12.100Z', type: 'event_msg', payload: { type: 'agent_message', message: 'Finished after compaction.' } },
        records.at(-1),
      ]));
      expect(messages.filter(message => message.role === 'assistant').map(message => message.durationSeconds))
        .toEqual([undefined, undefined, 192.165]);
    });

    it('calculates durationSeconds from user timestamp to last assistant event', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Quick question.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:05.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Quick answer.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      const assistant = messages.find(m => m.role === 'assistant');
      expect(assistant!.durationSeconds).toBe(5);
    });

    it('attaches durationSeconds to the last assistant message of the turn', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Do stuff.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            arguments: '{"command":"ls"}',
            call_id: 'call_dur_1',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:04.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_dur_1',
            output: 'Exit code: 0\nOutput:\nfile.txt',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:10.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Listed files.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      const assistant = messages.find(m => m.role === 'assistant');
      expect(assistant).toBeDefined();
      expect(assistant!.durationSeconds).toBe(10);
    });
  });

  describe('parseCodexSessionContent - server turn-ID exposure', () => {
    it('sets userMessageId on parsed user message when task_started has turn_id', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: '019d-uuid-turn-1' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.500Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Hello' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hi there!' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: '019d-uuid-turn-1' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages[0].userMessageId).toBe('019d-uuid-turn-1');
    });

    it('sets assistantMessageId on the terminal non-interrupt assistant bubble', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: '019d-uuid-turn-1' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.500Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Hello' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hi there!' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: '019d-uuid-turn-1' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages[1].assistantMessageId).toBe('019d-uuid-turn-1');
    });

    it('does NOT set assistantMessageId on interrupted assistant bubbles', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: '019d-uuid-aborted' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'Starting...' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'turn_aborted' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(1);
      expect(messages[0].isInterrupt).toBe(true);
      expect(messages[0].assistantMessageId).toBeUndefined();
    });

    it('sets assistantMessageId on the last non-interrupt bubble in a multi-bubble turn', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: '019d-uuid-multi' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.500Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Check files.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            arguments: '{"command":"ls"}',
            call_id: 'call_multi_1',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_multi_1',
            output: 'Exit code: 0\nOutput:\nfile.txt',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Found files.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:04.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: '019d-uuid-multi' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      // user + assistant (single bubble with tool call and text)
      const userMsg = messages.find(m => m.role === 'user');
      expect(userMsg!.userMessageId).toBe('019d-uuid-multi');

      // The last assistant message in the turn should get the checkpoint
      const assistantMsgs = messages.filter(m => m.role === 'assistant');
      const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
      expect(lastAssistant.assistantMessageId).toBe('019d-uuid-multi');
    });

    it('works without task_started (no server turn ID)', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Hello' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hi!' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages[0].userMessageId).toBeUndefined();
      expect(messages[1].assistantMessageId).toBeUndefined();
    });
  });

  describe('parseCodexSessionTurns - turn-aware parsing', () => {
    it('returns structured turns with stable turn IDs and messages', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'uuid-turn-1' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.500Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'First question' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'First answer' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: 'uuid-turn-1' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:03.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'uuid-turn-2' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:03.500Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Second question' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:04.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Second answer' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:05.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: 'uuid-turn-2' },
        }),
      ].join('\n');

      const turns = parseCodexSessionTurns(content);

      expect(turns).toHaveLength(2);
      expect(turns[0].turnId).toBe('uuid-turn-1');
      expect(turns[0].messages).toHaveLength(2);
      expect(turns[0].messages[0].role).toBe('user');
      expect(turns[0].messages[1].role).toBe('assistant');

      expect(turns[1].turnId).toBe('uuid-turn-2');
      expect(turns[1].messages).toHaveLength(2);
    });

    it('parseCodexSessionFile still works (uses parseCodexSessionTurns internally)', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'uuid-turn-flat' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.500Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Hello' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hi!' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: 'uuid-turn-flat' },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });

    it('preserves legacy item content inside mixed modern transcripts', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'uuid-turn-mixed' },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.100Z',
          type: 'event',
          event: {
            type: 'item.updated',
            item: {
              id: 'legacy-msg-1',
              type: 'agent_message',
              text: 'Legacy streamed answer',
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.200Z',
          type: 'event',
          event: {
            type: 'item.started',
            item: {
              id: 'legacy-cmd-1',
              type: 'command_execution',
              command: 'pwd',
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.300Z',
          type: 'event',
          event: {
            type: 'item.completed',
            item: {
              id: 'legacy-cmd-1',
              type: 'command_execution',
              aggregated_output: '/workspace',
              exit_code: 0,
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: 'uuid-turn-mixed' },
        }),
      ].join('\n');

      const turns = parseCodexSessionTurns(content);

      expect(turns).toHaveLength(1);
      expect(turns[0].turnId).toBe('uuid-turn-mixed');
      expect(turns[0].messages).toHaveLength(1);
      expect(turns[0].messages[0]).toMatchObject({
        role: 'assistant',
        content: 'Legacy streamed answer',
      });
      expect(turns[0].messages[0].toolCalls).toEqual([
        expect.objectContaining({
          id: 'legacy-cmd-1',
          name: 'Bash',
          status: 'completed',
          result: '/workspace',
        }),
      ]);
    });

    it('restores Codex display presentation for command and file-change history', () => {
      const content = [
        JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-presentation' } }),
        JSON.stringify({ type: 'event', event: { type: 'item.started', item: {
          id: 'read-history', type: 'command_execution', command: 'cat src/main.ts', cwd: '/workspace',
          command_actions: [{ type: 'read', path: '/workspace/src/main.ts', command: 'cat src/main.ts' }],
        } } }),
        JSON.stringify({ type: 'event', event: { type: 'item.completed', item: {
          id: 'read-history', type: 'command_execution', command: 'cat src/main.ts', cwd: '/workspace',
          command_actions: [{ type: 'read', path: '/workspace/src/main.ts', command: 'cat src/main.ts' }],
          aggregated_output: 'contents', exit_code: 0,
        } } }),
        JSON.stringify({ type: 'event', event: { type: 'item.completed', item: {
          id: 'edit-history', type: 'file_change', cwd: '/workspace', status: 'completed',
          changes: [{ path: '/workspace/src/other.ts', kind: 'update' }],
        } } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-presentation' } }),
      ].join('\n');

      const turns = parseCodexSessionTurns(content);
      const toolCalls = turns.flatMap(turn => turn.messages.flatMap(message => message.toolCalls ?? []));
      expect(toolCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'Bash',
          presentation: { name: 'Read', summary: 'src/main.ts' },
        }),
        expect.objectContaining({
          name: 'apply_patch',
          presentation: { name: 'Edit', summary: 'src/other.ts' },
        }),
      ]));
    });
  });

  describe('parseCodexSessionContent - persisted mcp_tool_call', () => {
    it('keeps a native MCP card when an opaque script cannot claim it', () => {
      const content = [
        JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'opaque-mcp-turn' } }),
        JSON.stringify({ type: 'response_item', payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'opaque-mcp-script',
          input: 'await runUnknownScript();',
        } }),
        JSON.stringify({ type: 'response_item', payload: {
          type: 'custom_tool_call_output',
          call_id: 'opaque-mcp-script',
          output: 'Script completed',
        } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: {
          type: 'McpToolCall',
          id: 'opaque-native-mcp',
          server: 'codex_apps',
          tool: 'github.fetch',
          arguments: { query: 'Codex app server' },
          status: 'completed',
          result: { content: [{ type: 'text', text: 'Native MCP result.' }] },
          error: null,
        } } }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const tools = messages.flatMap(message => message.toolCalls ?? []);
      expect(tools).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'opaque-native-mcp',
          name: 'mcp__codex_apps__github.fetch',
          result: 'Native MCP result.',
          status: 'completed',
        }),
      ]));
    });

    it('attaches a native McpToolCall result to its Code Mode script card', () => {
      const content = [
        JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'mcp-script-turn' } }),
        JSON.stringify({ type: 'response_item', payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'script-mcp-call',
          input: 'const r = await tools.mcp__codex_apps__github_fetch({query:"Codex app server"}); text(r);',
        } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: {
          type: 'McpToolCall',
          id: 'native-mcp-call',
          server: 'codex_apps',
          tool: 'github.fetch',
          arguments: { query: 'Codex app server' },
          status: 'completed',
          result: { content: [{ type: 'text', text: 'Native MCP result.' }] },
          error: null,
        } } }),
        JSON.stringify({ type: 'response_item', payload: {
          type: 'custom_tool_call_output',
          call_id: 'script-mcp-call',
          output: 'Raw script output',
        } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'mcp-script-turn' } }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const tools = messages.flatMap(message => message.toolCalls ?? []);
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        id: 'script-mcp-call',
        name: 'mcp__codex_apps__github.fetch',
        status: 'completed',
        result: 'Native MCP result.',
      });
    });

    it('restores mcp_tool_call from response_item as mcp__server__tool', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Use MCP tool.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'mcp_tool_call',
            server: 'myserver',
            tool: 'mytool',
            call_id: 'call_mcp_1',
            status: 'completed',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-27T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'MCP tool executed.' }],
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      const assistant = messages.find(m => m.role === 'assistant' && m.toolCalls);
      expect(assistant).toBeDefined();

      const mcpTool = assistant!.toolCalls!.find(tc => tc.name === 'mcp__myserver__mytool');
      expect(mcpTool).toBeDefined();
      expect(mcpTool!.id).toBe('call_mcp_1');
      expect(mcpTool!.status).toBe('completed');
      expect(mcpTool!.presentation).toEqual({ name: 'myserver', summary: 'mytool' });
    });

    it('preserves MCP arguments and structured result text', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'mcp_tool_call',
            server: 'filesystem',
            tool: 'read_file',
            call_id: 'call_mcp_2',
            status: 'completed',
            arguments: { path: 'README.md' },
            result: {
              content: [
                { type: 'text', text: 'line 1' },
                { type: 'text', text: 'line 2' },
              ],
            },
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const assistant = messages.find(m => m.role === 'assistant' && m.toolCalls);
      const mcpTool = assistant!.toolCalls!.find(tc => tc.id === 'call_mcp_2');

      expect(mcpTool).toMatchObject({
        name: 'mcp__filesystem__read_file',
        input: { path: 'README.md' },
        status: 'completed',
        result: 'line 1\nline 2',
      });
    });

    it.each(['Permission denied', { message: 'Permission denied' }])('preserves native MCP error output: %j', error => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-27T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'mcp_tool_call',
            server: 'filesystem',
            tool: 'write_file',
            call_id: 'call_mcp_3',
            status: 'failed',
            arguments: '{"path":"README.md"}',
            error,
          },
        }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);
      const assistant = messages.find(m => m.role === 'assistant' && m.toolCalls);
      const mcpTool = assistant!.toolCalls!.find(tc => tc.id === 'call_mcp_3');

      expect(mcpTool).toMatchObject({
        name: 'mcp__filesystem__write_file',
        input: { path: 'README.md' },
        status: 'error',
        result: 'Permission denied',
      });
    });
  });


  describe('parseCodexSessionContent - persisted shell tool presentation', () => {
    it('restores a readable label for historical exec_command calls', () => {
      const content = [
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            name: 'exec_command',
            call_id: 'call-read',
            input: JSON.stringify({ cmd: 'cat src/main.ts' }),
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call-read',
            output: 'file contents',
          },
        }),
      ].join('\n');

      const toolCalls = parseCodexSessionContent(content)
        .flatMap(message => message.toolCalls ?? []);

      expect(toolCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'Bash',
          presentation: { name: 'Read', summary: 'src/main.ts' },
        }),
      ]));
    });

    it('labels historical rg file listings when the shell command is wrapped', () => {
      const content = JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec_command',
          call_id: 'call-list-files',
          input: JSON.stringify({ cmd: `/usr/bin/zsh -lc "rg --files -g AGENTS.md"` }),
        },
      });

      const toolCalls = parseCodexSessionContent(content)
        .flatMap(message => message.toolCalls ?? []);

      expect(toolCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'Bash',
          presentation: { name: 'Find', summary: 'files' },
        }),
      ]));
    });

    it('restores labels for a single command inside a historical exec envelope', () => {
      const content = JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-envelope',
          input: 'text(await tools.exec_command({cmd:"cat src/main.ts",workdir:"/workspace"}));',
        },
      });

      const toolCalls = parseCodexSessionContent(content)
        .flatMap(message => message.toolCalls ?? []);

      expect(toolCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'Bash',
          presentation: { name: 'Read', summary: 'src/main.ts' },
        }),
      ]));
    });
  });

  describe('parseCodexSessionContent - context_compacted boundary', () => {
    it.each([false, true])('restores record-only compaction and deduplicates its event (event: %s)', (withEvent) => {
      const records = [
        { type: 'event_msg', payload: { type: 'task_started', turn_id: 'compacted-turn' } },
        { type: 'event_msg', payload: { type: 'agent_message', message: 'Before' } },
        { type: 'compacted', payload: { message: 'Hidden summary', replacement_history: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hidden replacement' }] },
        ] } },
        ...(withEvent ? [{ type: 'event_msg', payload: { type: 'context_compacted' } }] : []),
        { type: 'event_msg', payload: { type: 'agent_message', message: 'After' } },
        { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'compacted-turn' } },
      ];
      const content = records.map((record, seconds) => JSON.stringify({ timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(), ...record })).join('\n');

      const turns = parseCodexSessionTurns(content);
      expect(turns).toHaveLength(1);
      expect(turns[0].turnId).toBe('compacted-turn');
      expect(turns[0].messages.map(message => ({ content: message.content, blocks: message.contentBlocks }))).toEqual([
        { content: 'Before', blocks: [{ type: 'text', content: 'Before' }] },
        { content: '', blocks: [{ type: 'context_compacted' }] },
        { content: 'After', blocks: [{ type: 'text', content: 'After' }] },
      ]);
    });

    it('keeps repeated record-only and event-only compactions distinct', () => {
      const records = [
        { type: 'compacted', payload: { message: 'Hidden first summary' } },
        { type: 'compacted', payload: { message: 'Hidden second summary' } },
        { type: 'event_msg', payload: { type: 'context_compacted' } },
        { type: 'event_msg', payload: { type: 'agent_message', message: 'Between boundaries' } },
        { type: 'event_msg', payload: { type: 'context_compacted' } },
      ];
      const content = records.map((record, seconds) => JSON.stringify({ timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(), ...record })).join('\n');
      expect(parseCodexSessionContent(content).map(message => message.contentBlocks)).toEqual([
        [{ type: 'context_compacted' }],
        [{ type: 'context_compacted' }],
        [{ type: 'text', content: 'Between boundaries' }],
        [{ type: 'context_compacted' }],
      ]);
    });

    it('keeps post-compaction records in the active turn when auto-compaction happens mid-turn', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-07-05T07:19:07.987Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'uuid-auto-compact' },
        }),
        JSON.stringify({
          timestamp: '2026-07-05T07:19:10.303Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Update the template.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-05T07:19:54.927Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'I will update the template.' },
        }),
        JSON.stringify({
          timestamp: '2026-07-05T07:19:54.927Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'I will update the template.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-05T07:20:02.971Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            call_id: 'call-before-compact',
            arguments: '{"cmd":"rg breadcrumb template"}',
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-05T07:20:03.061Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call-before-compact',
            output: 'Process exited with code 0\nOutput:\nmatch',
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-05T07:23:48.653Z',
          type: 'compacted',
          payload: { message: '', replacement_history: [] },
        }),
        JSON.stringify({
          timestamp: '2026-07-05T07:23:48.660Z',
          type: 'event_msg',
          payload: { type: 'context_compacted' },
        }),
        JSON.stringify({
          timestamp: '2026-07-05T07:23:52.499Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            call_id: 'call-after-compact',
            arguments: '{"cmd":"npm test"}',
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-05T07:23:52.934Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call-after-compact',
            output: 'Process exited with code 0\nOutput:\npassed',
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-05T07:25:41.421Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'Template updated.' },
        }),
        JSON.stringify({
          timestamp: '2026-07-05T07:25:41.424Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Template updated.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-05T07:25:41.432Z',
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: 'uuid-auto-compact' },
        }),
      ].join('\n');

      const turns = parseCodexSessionTurns(content);

      expect(turns).toHaveLength(1);
      expect(turns[0].turnId).toBe('uuid-auto-compact');
      expect(turns[0].messages.map(message => ({
        role: message.role,
        content: message.content,
        blockTypes: message.contentBlocks?.map(block => block.type),
        tools: message.toolCalls?.map(tool => tool.id),
      }))).toEqual([
        {
          role: 'user',
          content: 'Update the template.',
          blockTypes: undefined,
          tools: undefined,
        },
        {
          role: 'assistant',
          content: 'I will update the template.',
          blockTypes: ['text', 'tool_use'],
          tools: ['call-before-compact'],
        },
        {
          role: 'assistant',
          content: '',
          blockTypes: ['context_compacted'],
          tools: undefined,
        },
        {
          role: 'assistant',
          content: 'Template updated.',
          blockTypes: ['tool_use', 'text'],
          tools: ['call-after-compact'],
        },
      ]);
    });

    it('preserves visible transcript records instead of replaying compacted replacement_history', () => {
      const content = [
        JSON.stringify({ timestamp: '2026-03-03T16:00:00.000Z', type: 'event_msg', payload: { type: 'task_started' } }),
        JSON.stringify({ timestamp: '2026-03-03T16:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } }),
        JSON.stringify({ timestamp: '2026-03-03T16:00:01.500Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'call-1', arguments: '{"cmd":"npm test"}' } }),
        JSON.stringify({ timestamp: '2026-03-03T16:00:01.700Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output: 'Process exited with code 0\nOutput:\npassed' } }),
        JSON.stringify({ timestamp: '2026-03-03T16:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi there!' }] } }),
        JSON.stringify({ timestamp: '2026-03-03T16:00:03.000Z', type: 'event_msg', payload: { type: 'task_complete' } }),
        JSON.stringify({ timestamp: '2026-03-03T16:00:03.500Z', type: 'event_msg', payload: { type: 'task_started' } }),
        // Compaction replacement_history is provider context, not visible UI history.
        JSON.stringify({
          timestamp: '2026-03-03T16:00:04.000Z',
          type: 'compacted',
          payload: {
            message: '',
            replacement_history: [
              {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: '<COMPACTION_SUMMARY>\nSummary after compact' }],
              },
              {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: 'replacement-only user message' }],
              },
              {
                type: 'compaction',
                encrypted_content: 'encrypted-summary',
              },
            ],
          },
        }),
        JSON.stringify({ timestamp: '2026-03-03T16:00:04.000Z', type: 'event_msg', payload: { type: 'context_compacted' } }),
        // Next turn after compaction
        JSON.stringify({ timestamp: '2026-03-03T16:00:05.000Z', type: 'event_msg', payload: { type: 'task_started' } }),
        JSON.stringify({ timestamp: '2026-03-03T16:00:06.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'continue' }] } }),
        JSON.stringify({ timestamp: '2026-03-03T16:00:07.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Continuing after compact.' }] } }),
        JSON.stringify({ timestamp: '2026-03-03T16:00:08.000Z', type: 'event_msg', payload: { type: 'task_complete' } }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages.map(m => m.content)).toContain('hello');
      expect(messages.map(m => m.content)).toContain('Hi there!');
      expect(messages.map(m => m.content)).not.toContain('<COMPACTION_SUMMARY>\nSummary after compact');
      expect(messages.map(m => m.content)).not.toContain('replacement-only user message');

      const firstAssistant = messages.find(m => m.role === 'assistant' && m.content === 'Hi there!');
      expect(firstAssistant).toBeDefined();
      expect(firstAssistant!.toolCalls).toHaveLength(1);
      expect(firstAssistant!.toolCalls![0]).toMatchObject({
        id: 'call-1',
        name: 'Bash',
        status: 'completed',
      });

      expect(messages[0]).toMatchObject({
        role: 'user',
        content: 'hello',
      });

      const compactMsg = messages.find(m =>
        m.contentBlocks?.some(b => b.type === 'context_compacted'),
      );
      expect(compactMsg).toBeDefined();
      expect(compactMsg!.role).toBe('assistant');
      expect(compactMsg!.content).toBe('');

      // context_compacted should appear after the preserved pre-compaction transcript.
      const compactIdx = messages.indexOf(compactMsg!);
      expect(compactIdx).toBeGreaterThan(0);

      const beforeCompact = messages[compactIdx - 1];
      expect(beforeCompact.role).toBe('assistant');
      expect(beforeCompact.content).toBe('Hi there!');

      const afterCompact = messages[compactIdx + 1];
      expect(afterCompact.role).toBe('user');
      expect(afterCompact.content).toContain('continue');
    });

    it('renders compact boundaries without surfacing replacement_history summaries', () => {
      const content = [
        JSON.stringify({
          timestamp: '2026-03-03T16:00:00.000Z',
          type: 'compacted',
          payload: {
            message: '',
            replacement_history: [
              {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: 'First summary' }],
              },
            ],
          },
        }),
        JSON.stringify({ timestamp: '2026-03-03T16:00:00.000Z', type: 'event_msg', payload: { type: 'context_compacted' } }),
        JSON.stringify({
          timestamp: '2026-03-03T16:00:01.000Z',
          type: 'compacted',
          payload: {
            message: '',
            replacement_history: [
              {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: 'Second summary' }],
              },
            ],
          },
        }),
        JSON.stringify({ timestamp: '2026-03-03T16:00:01.000Z', type: 'event_msg', payload: { type: 'context_compacted' } }),
      ].join('\n');

      const messages = parseCodexSessionContent(content);

      expect(messages).toHaveLength(2);
      expect(messages.map(m => m.content)).not.toContain('First summary');
      expect(messages.map(m => m.content)).not.toContain('Second summary');
      const compactMessages = messages.filter(m =>
        m.contentBlocks?.some(b => b.type === 'context_compacted'),
      );
      expect(compactMessages).toHaveLength(2);
    });
  });
});

it('restores native output token usage and duration for the main thread turn', () => {
  const records = [
    { type: 'session_meta', payload: { id: 'main' } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Work' } },
    { type: 'token_usage_record', payload: {
      thread_id: 'main', turn_id: 'turn-1', turn_token_usage: { output_tokens: 125 },
    } },
    { type: 'response_item', payload: {
      type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }],
    } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1', duration_ms: 2_500 } },
  ].map((record, index) => JSON.stringify({
    timestamp: new Date(1_000 + index * 500).toISOString(),
    ...record,
  })).join('\n');

  expect(parseCodexSessionContent(records).at(-1)?.turnStats).toEqual({
    outputTokens: 125,
    durationMs: 2_500,
  });
  expect(parseCodexSessionContent(records).at(-1)?.durationSeconds).toBe(2.5);
});
