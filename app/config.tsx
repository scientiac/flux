import axios from 'axios';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Dialog, Divider, HelperText, Portal, Snackbar, Text, TextInput, useTheme } from 'react-native-paper';
import { useAppContext } from '../context/AppContext';

export default function Config() {
    const { config, updateRepoConfig, removeRepoConfig } = useAppContext();
    const theme = useTheme();
    const router = useRouter();
    const { from } = useLocalSearchParams();

    const repoPath = config.repo;
    const currentRepoConfig = repoPath ? config.repoConfigs[repoPath] : null;

    const [contentDir, setContentDir] = useState(currentRepoConfig?.contentDir || 'content/posts');
    const [assetsDir, setAssetsDir] = useState(currentRepoConfig?.assetsDir || 'static/assets');
    const [postTemplate, setPostTemplate] = useState(currentRepoConfig?.postTemplate || "+++\ntitle: {{title}}\ndate: {{date}}\ntime: {{time}}\n+++\n\n");
    const [isValidating, setIsValidating] = useState(false);

    // Remove confirmation dialog
    const [removeDialogVisible, setRemoveDialogVisible] = useState(false);

    // Snackbar
    const [snackbarVisible, setSnackbarVisible] = useState(false);
    const [snackbarMsg, setSnackbarMsg] = useState('');

    useEffect(() => {
        if (currentRepoConfig) {
            setContentDir(currentRepoConfig.contentDir);
            setAssetsDir(currentRepoConfig.assetsDir);
            if (currentRepoConfig.postTemplate) setPostTemplate(currentRepoConfig.postTemplate);
        }
    }, [currentRepoConfig]);

    const validateAndSave = useCallback(async () => {
        if (!repoPath) return;
        setIsValidating(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            if (!token) throw new Error('Not authenticated');

            // Sanitize: strip trailing slashes to prevent // in paths
            const cleanContentDir = contentDir.endsWith('/') ? contentDir.slice(0, -1) : contentDir;
            const cleanAssetsDir = assetsDir.endsWith('/') ? assetsDir.slice(0, -1) : assetsDir;

            // 1. Ensure folders exist or create them
            const dirs = [cleanContentDir, cleanAssetsDir];
            for (const dir of dirs) {
                try {
                    await axios.get(`https://api.github.com/repos/${repoPath}/contents/${dir}`, {
                        headers: { Authorization: `token ${token}` }
                    });
                } catch (e: any) {
                    if (e.response?.status === 404) {
                        // Create placeholder to initialize folder
                        await axios.put(`https://api.github.com/repos/${repoPath}/contents/${dir}/.gitkeep`, {
                            message: `Initialize ${dir}`,
                            content: 'Ym9vdHN0cmFw', // "bootstrap" in base64
                        }, {
                            headers: { Authorization: `token ${token}` }
                        });
                    } else {
                        throw e;
                    }
                }
            }

            await updateRepoConfig(repoPath, {
                contentDir: cleanContentDir,
                assetsDir: cleanAssetsDir,
                postTemplate: postTemplate
            });
            setSnackbarMsg('Settings saved successfully');
            setSnackbarVisible(true);
            setTimeout(() => {
                if (from === 'dashboard') router.back();
                else router.replace('/files');
            }, 1000);
        } catch (e: any) {
            setSnackbarMsg(e.message || 'Validation failed');
            setSnackbarVisible(true);
        } finally {
            setIsValidating(false);
        }
    }, [repoPath, contentDir, assetsDir, postTemplate, updateRepoConfig, from, router, setSnackbarMsg, setSnackbarVisible]);

    const handleRemoveSite = useCallback(async () => {
        if (!repoPath) return;
        setRemoveDialogVisible(false);
        await removeRepoConfig(repoPath);
        setSnackbarMsg('Site removed from Flux');
        setSnackbarVisible(true);
        setTimeout(() => router.replace('/'), 800);
    }, [repoPath, removeRepoConfig, setSnackbarMsg, setSnackbarVisible, router]);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header elevated={false} style={{ backgroundColor: theme.colors.background }}>
                <Appbar.BackAction onPress={() => router.back()} />
                <Appbar.Content title="Site Settings" titleStyle={{ fontWeight: 'bold' }} />
            </Appbar.Header>

            <ScrollView contentContainerStyle={styles.content}>
                <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.outline }]}>
                    Settings for <Text style={{ fontWeight: 'bold', color: theme.colors.onBackground }}>{repoPath}</Text>
                </Text>

                <View style={styles.inputGroup}>
                    <TextInput
                        label="Posts Directory"
                        value={contentDir}
                        onChangeText={setContentDir}
                        mode="flat"
                        placeholder="e.g. content/posts"
                        style={[styles.capsuleInput, { backgroundColor: theme.colors.surfaceVariant }]}
                        selectionColor={theme.colors.primary}
                        activeUnderlineColor={theme.colors.primary}
                        left={<TextInput.Icon icon="folder-outline" />}
                    />
                    <HelperText type="info">Where your markdown files are stored.</HelperText>
                </View>

                <View style={styles.inputGroup}>
                    <TextInput
                        label="Assets Directory"
                        value={assetsDir}
                        onChangeText={setAssetsDir}
                        mode="flat"
                        placeholder="e.g. static/assets"
                        style={[styles.capsuleInput, { backgroundColor: theme.colors.surfaceVariant }]}
                        selectionColor={theme.colors.primary}
                        activeUnderlineColor={theme.colors.primary}
                        left={<TextInput.Icon icon="image-outline" />}
                    />
                    <HelperText type="info">Where images and media will be uploaded.</HelperText>
                </View>

                <View style={styles.inputGroup}>
                    <TextInput
                        label="Post Frontmatter Template"
                        value={postTemplate}
                        onChangeText={setPostTemplate}
                        mode="flat"
                        multiline
                        numberOfLines={10}
                        placeholder="---\ntitle: {{title}}\n---"
                        style={[styles.capsuleInput, { backgroundColor: theme.colors.surfaceVariant, minHeight: 180, paddingVertical: 8 }]}
                        selectionColor={theme.colors.primary}
                        activeUnderlineColor={theme.colors.primary}
                        left={<TextInput.Icon icon="file-document-edit-outline" style={{ marginTop: 8 }} />}
                    />
                    <HelperText type="info">Defines the frontmatter for new posts. Use {'{{title}}'}, {'{{date}}'} and {'{{time}}'} as placeholders.</HelperText>
                </View>

                <Button
                    mode="contained"
                    onPress={validateAndSave}
                    loading={isValidating}
                    disabled={isValidating || !contentDir || !assetsDir}
                    style={styles.saveButton}
                    contentStyle={styles.saveButtonContent}
                    icon="content-save-outline"
                >
                    Save & Continue
                </Button>

                {currentRepoConfig && (
                    <>
                        <Divider style={{ marginTop: 40, marginBottom: 24 }} />
                        <View style={[styles.dangerZone, { backgroundColor: theme.colors.errorContainer, borderColor: theme.colors.error }]}>
                            <Text variant="titleSmall" style={{ color: theme.colors.onErrorContainer, fontWeight: '700', marginBottom: 4 }}>Remove Site</Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onErrorContainer, opacity: 0.8, marginBottom: 16 }}>
                                This will remove the site configuration, cached files, and drafts from Flux. Your GitHub repository will not be affected.
                            </Text>
                            <Button
                                mode="contained"
                                onPress={() => setRemoveDialogVisible(true)}
                                icon="delete-outline"
                                buttonColor={theme.colors.error}
                                textColor={theme.colors.onError}
                                style={{ borderRadius: 20 }}
                            >
                                Remove from Flux
                            </Button>
                        </View>
                    </>
                )}
            </ScrollView>

            <Portal>
                <Dialog visible={removeDialogVisible} onDismiss={() => setRemoveDialogVisible(false)} style={{ borderRadius: 28 }}>
                    <Dialog.Icon icon="alert-circle-outline" color={theme.colors.error} />
                    <Dialog.Title style={{ textAlign: 'center' }}>Remove Site?</Dialog.Title>
                    <Dialog.Content>
                        <Text variant="bodyMedium" style={{ textAlign: 'center' }}>
                            This will remove <Text style={{ fontWeight: 'bold' }}>{repoPath}</Text> from your configured sites, including its cached data and local drafts. This does not delete anything from GitHub.
                        </Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setRemoveDialogVisible(false)}>Cancel</Button>
                        <Button onPress={handleRemoveSite} textColor={theme.colors.error}>Remove</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>

            <Snackbar
                visible={snackbarVisible}
                onDismiss={() => setSnackbarVisible(false)}
                duration={3000}
                style={{ backgroundColor: theme.colors.secondaryContainer, borderRadius: 12 }}
            >
                <Text style={{ color: theme.colors.onSecondaryContainer }}>{snackbarMsg}</Text>
            </Snackbar>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 24, paddingBottom: 48 },
    subtitle: { marginBottom: 24 },
    inputGroup: { marginBottom: 16 },
    capsuleInput: {
        backgroundColor: 'rgba(0,0,0,0.03)',
    },
    saveButton: { marginTop: 24, borderRadius: 28 },
    saveButtonContent: { height: 56 },
    dangerZone: {
        padding: 20,
        borderRadius: 16,
        borderWidth: 1,
    },
});

