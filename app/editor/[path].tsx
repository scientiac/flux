import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Buffer } from 'buffer';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput as RNTextInput, ScrollView, StyleSheet, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Appbar, Button, IconButton, Modal, Portal, Snackbar, Text, TextInput, ToggleButton, useTheme } from 'react-native-paper';
import { useAppContext } from '../../context/AppContext';

export default function Editor() {
    const { path } = useLocalSearchParams();
    const isNew = path === 'new';
    const decodedPath = isNew ? '' : decodeURIComponent(path as string);
    const { config } = useAppContext();
    const theme = useTheme();
    const router = useRouter();

    const [content, setContent] = useState('');
    const [title, setTitle] = useState(isNew ? 'New Post' : decodedPath.split('/').pop()?.replace('.md', '') || '');
    const [isLoading, setIsLoading] = useState(!isNew);
    const [isSaving, setIsSaving] = useState(false);
    const [mode, setMode] = useState<'edit' | 'preview'>('edit');
    const [sha, setSha] = useState<string | null>(null);
    const [selection, setSelection] = useState({ start: 0, end: 0 });
    const [pendingImages, setPendingImages] = useState<{ localUri: string, filename: string }[]>([]);
    const [snackbarVisible, setSnackbarVisible] = useState(false);
    const [snackbarMsg, setSnackbarMsg] = useState('');
    const [commitMsg, setCommitMsg] = useState(isNew ? `Create ${title}` : `Update ${title}`);
    const [isCommitModalVisible, setIsCommitModalVisible] = useState(false);

    const inputRef = useRef<RNTextInput>(null);
    const AUTOSAVE_KEY = `flux_draft_${isNew ? 'new' : decodedPath}`;

    const fetchFile = async () => {
        if (isNew) {
            const draft = await AsyncStorage.getItem(AUTOSAVE_KEY);
            if (draft) setContent(draft);
            else setContent('---\ntitle: New Post\ndate: ' + new Date().toISOString().split('T')[0] + '\ndraft: true\n---\n\nStart writing here...');
            return;
        }
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const response = await axios.get(`https://api.github.com/repos/${config.repo}/contents/${decodedPath}`, {
                headers: { Authorization: `token ${token}` }
            });
            const rawContent = Buffer.from(response.data.content, 'base64').toString('utf8');

            // Check for local draft first
            const draft = await AsyncStorage.getItem(AUTOSAVE_KEY);
            setContent(draft || rawContent);
            setSha(response.data.sha);
        } catch (e) {
            console.error('[Editor] Fetch failed', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchFile();
    }, [path]);

    // Autosave effect
    useEffect(() => {
        if (!content || isLoading) return;
        const timer = setTimeout(async () => {
            await AsyncStorage.setItem(AUTOSAVE_KEY, content);
        }, 2000);
        return () => clearTimeout(timer);
    }, [content]);

    const handleSave = async () => {
        setIsCommitModalVisible(false);
        setIsSaving(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            if (!token) throw new Error('Not authenticated');

            // 1. Upload pending images
            for (const img of pendingImages) {
                const response = await fetch(img.localUri);
                const blob = await response.blob();
                const reader = new FileReader();
                const base64Promise = new Promise<string>((resolve) => {
                    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                    reader.readAsDataURL(blob);
                });
                const base64Data = await base64Promise;

                const assetPath = `${config.assetsDir}/${img.filename}`;
                await axios.put(`https://api.github.com/repos/${config.repo}/contents/${assetPath}`, {
                    message: `Upload ${img.filename}`,
                    content: base64Data
                }, {
                    headers: { Authorization: `token ${token}` }
                });
            }

            // 2. Save Markdown
            const savePath = isNew ? `${config.contentDir}/${title.toLowerCase().replace(/\s+/g, '-')}.md` : decodedPath;
            const payload = {
                message: commitMsg || (isNew ? `Create ${title}` : `Update ${title}`),
                content: Buffer.from(content).toString('base64'),
                sha: sha || undefined
            };

            const response = await axios.put(`https://api.github.com/repos/${config.repo}/contents/${savePath}`, payload, {
                headers: { Authorization: `token ${token}` }
            });

            setSha(response.data.content.sha);
            setPendingImages([]);
            await AsyncStorage.removeItem(AUTOSAVE_KEY);
            setSnackbarMsg('Post published to GitHub');
            setSnackbarVisible(true);

            if (isNew) {
                router.replace(`/editor/${encodeURIComponent(savePath)}`);
            }
        } catch (e: any) {
            console.error('[Editor] Save failed', e);
            setSnackbarMsg(e.message || 'Failed to save post');
            setSnackbarVisible(true);
        } finally {
            setIsSaving(false);
        }
    };

    const insertText = (before: string, after: string = '') => {
        const { start, end } = selection;
        const selectedText = content.substring(start, end);
        const newContent = content.substring(0, start) + before + selectedText + after + content.substring(end);
        setContent(newContent);
    };

    const pickImage = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            quality: 0.8,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            const asset = result.assets[0];
            const resized = await ImageManipulator.manipulateAsync(
                asset.uri,
                [{ resize: { width: 1200 } }],
                { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
            );

            const filename = `img_${Date.now()}.jpg`;
            setPendingImages(prev => [...prev, { localUri: resized.uri, filename }]);

            const relativePath = `/${config.assetsDir}/${filename}`;
            insertText(`![image](${relativePath})`, '');
        }
    };

    const toggleDraft = () => {
        if (content.includes('draft: true')) {
            setContent(content.replace('draft: true', 'draft: false'));
        } else if (content.includes('draft: false')) {
            setContent(content.replace('draft: false', 'draft: true'));
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.container, { backgroundColor: theme.colors.background }]}
        >
            <Appbar.Header elevated style={{ backgroundColor: theme.colors.surface }}>
                <Appbar.BackAction onPress={() => router.back()} />
                <Appbar.Content title={title} titleStyle={styles.appbarTitle} />
                <ToggleButton.Row onValueChange={v => v && setMode(v as any)} value={mode}>
                    <ToggleButton icon="pencil-outline" value="edit" />
                    <ToggleButton icon="eye-outline" value="preview" />
                </ToggleButton.Row>
                <Appbar.Action
                    icon="cloud-upload-outline"
                    onPress={() => setIsCommitModalVisible(true)}
                    disabled={isSaving || isLoading}
                />
            </Appbar.Header>

            <View style={styles.editorContainer}>
                {mode === 'edit' ? (
                    <>
                        {isNew && (
                            <TextInput
                                style={[styles.titleInput, { color: theme.colors.primary, backgroundColor: theme.colors.surface }]}
                                value={title}
                                onChangeText={setTitle}
                                placeholder="File name..."
                            />
                        )}
                        <RNTextInput
                            ref={inputRef}
                            style={[styles.input, { color: theme.colors.onSurface, backgroundColor: theme.colors.surface }]}
                            multiline
                            value={content}
                            onChangeText={setContent}
                            onSelectionChange={e => setSelection(e.nativeEvent.selection)}
                            placeholder="Start writing..."
                            textAlignVertical="top"
                        />
                        <View style={[styles.toolbar, { backgroundColor: theme.colors.surface }]}>
                            <IconButton icon="format-header-1" onPress={() => insertText('# ', '')} />
                            <IconButton icon="format-bold" onPress={() => insertText('**', '**')} />
                            <IconButton icon="format-italic" onPress={() => insertText('_', '_')} />
                            <IconButton icon="image-outline" onPress={pickImage} />
                            <IconButton
                                icon={content.includes('draft: true') ? "eye-off-outline" : "eye-check-outline"}
                                onPress={toggleDraft}
                                iconColor={content.includes('draft: true') ? theme.colors.outline : theme.colors.primary}
                            />
                        </View>
                    </>
                ) : (
                    <ScrollView contentContainerStyle={styles.preview}>
                        <Markdown style={{
                            body: { color: theme.colors.onSurface, fontSize: 16, lineHeight: 24 },
                            heading1: { color: theme.colors.primary, marginVertical: 12, fontWeight: 'bold' },
                            image: { borderRadius: 12, marginVertical: 16 }
                        }}>
                            {content}
                        </Markdown>
                    </ScrollView>
                )}
            </View>

            <Portal>
                <Modal
                    visible={isCommitModalVisible}
                    onDismiss={() => setIsCommitModalVisible(false)}
                    contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
                >
                    <Text variant="titleLarge" style={styles.modalTitle}>Commit Changes</Text>
                    <TextInput
                        label="Commit Message"
                        value={commitMsg}
                        onChangeText={setCommitMsg}
                        mode="outlined"
                        style={styles.modalInput}
                    />
                    <View style={styles.modalButtons}>
                        <Button onPress={() => setIsCommitModalVisible(false)}>Cancel</Button>
                        <Button mode="contained" onPress={handleSave}>Push to GitHub</Button>
                    </View>
                </Modal>
            </Portal>

            <Snackbar
                visible={snackbarVisible}
                onDismiss={() => setSnackbarVisible(false)}
                duration={3000}
                action={{ label: 'OK', onPress: () => setSnackbarVisible(false) }}
            >
                {snackbarMsg}
            </Snackbar>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    appbarTitle: { fontSize: 18, fontWeight: 'bold' },
    editorContainer: { flex: 1 },
    titleInput: { fontSize: 22, fontWeight: 'bold', padding: 20, paddingBottom: 0 },
    input: { flex: 1, padding: 20, fontSize: 17, lineHeight: 26 },
    toolbar: {
        flexDirection: 'row',
        paddingHorizontal: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(0,0,0,0.1)',
        justifyContent: 'space-around',
    },
    preview: { padding: 24 },
    modal: { padding: 24, margin: 24, borderRadius: 28 },
    modalTitle: { marginBottom: 16, fontWeight: 'bold' },
    modalInput: { marginBottom: 24 },
    modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }
});
